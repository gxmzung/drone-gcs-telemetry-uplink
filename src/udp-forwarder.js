"use strict";

const dgram = require("node:dgram");
const { createHash } = require("node:crypto");
const { parseMavlinkFrames, decodeMavlinkMessage } = require("./mavlink");
const { DeviceSequenceMetrics } = require("./device-metrics");
const { TelemetryAggregator } = require("./telemetry-aggregator");

function startUdpForwarder(config, logger, options = {}) {
  if (config.forwardEnabled === true && config.listenPort === config.targetPort &&
      (config.listenHost === config.targetHost || ['127.0.0.1','localhost','0.0.0.0'].includes(config.targetHost))) {
    return Promise.reject(new Error('UDP forwarding destination loops back to listener'));
  }
  const socket = dgram.createSocket("udp4");
  const recentlyForwarded = new Map();
  const deviceMetrics = new DeviceSequenceMetrics();
  const telemetryAggregator = new TelemetryAggregator(options.telemetry);

  const stats = {
    packets: 0,
    bytes: 0,
    sendErrors: 0,
    loopPacketsSuppressed: 0,
    mavlinkFrames: 0,
    telemetryCount: 0,
    decodedFrames: 0,
    validatedMessageCounts: {},
    rejectedTelemetryFrames: 0,
    rejectedTelemetryMessageCounts: {},
    lastDecodedTelemetryAt: null,
    telemetryIdentity: null,
    completedSeqWindows: 0,
    lastSource: null,
    lastPacketAt: null,
    lastTelemetryAt: null,
    messageCounts: {},
    devices: [],
  };

  socket.on("message", (message, remote) => {
    const now = Date.now();

    stats.packets += 1;
    stats.bytes += message.length;
    stats.lastSource = `${remote.address}:${remote.port}`;
    stats.lastPacketAt = new Date(now).toISOString();

    const frames = parseMavlinkFrames(message);
    stats.mavlinkFrames += frames.length;

    for (const frame of frames) {
      stats.messageCounts[frame.messageId] = (stats.messageCounts[frame.messageId] ?? 0) + 1;

      const observation = deviceMetrics.observe(frame, now);
      logger.device("DEVICE_PACKET", observation.packet);

      for (const summary of observation.completed) {
        stats.completedSeqWindows += 1;
        logger.device("DEVICE_SEQ_WINDOW", summary);
        logger.info("DEVICE_SEQ_WINDOW", summary);
      }

      const decoded = decodeMavlinkMessage(message, frame);
      if (decoded) {
        stats.decodedFrames++;
        stats.validatedMessageCounts[frame.messageId] = (stats.validatedMessageCounts[frame.messageId] ?? 0) + 1;
        stats.lastDecodedTelemetryAt = new Date(now).toISOString();
      } else if ([0,1,24,30,33,42].includes(frame.messageId)) {
        stats.rejectedTelemetryFrames++;
        stats.rejectedTelemetryMessageCounts[frame.messageId] = (stats.rejectedTelemetryMessageCounts[frame.messageId] ?? 0) + 1;
      }
      const telemetry = telemetryAggregator.accept(
        frame,
        decoded,
        `${remote.address}:${remote.port}`,
        now,
      );

      if (telemetry) {
        stats.telemetryCount += 1;
        stats.lastTelemetryAt = telemetry.observedAt;
        stats.telemetryIdentity = { systemId: frame.systemId, componentId: frame.componentId };
        options.onTelemetry?.(telemetry);
      }
    }

    stats.devices = deviceMetrics.snapshot();

    if (config.forwardEnabled === true) {
      const digest = createHash('sha256').update(message).digest('hex');
      for (const [key,at] of recentlyForwarded) if (now-at>2000) recentlyForwarded.delete(key);
      if (recentlyForwarded.has(digest)) {stats.loopPacketsSuppressed++;return;}
      if (recentlyForwarded.size>=1000) recentlyForwarded.delete(recentlyForwarded.keys().next().value);
      recentlyForwarded.set(digest,now);
      socket.send(message, config.targetPort, config.targetHost, (error) => {
        if (error) {
          stats.sendErrors += 1;
          logger.error("UDP_SEND_FAILED", {
            error: error.message,
            target: `${config.targetHost}:${config.targetPort}`,
          });
        }
      });
    }
  });

  socket.on("error", (error) => {
    logger.error("UDP_SOCKET_ERROR", { error: error.message });
  });

  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(config.listenPort, config.listenHost, () => {
      socket.removeListener("error", reject);
      const address = socket.address();
      logger.info("UDP_LISTENING", {
        listen: `${address.address}:${address.port}`,
        target: config.forwardEnabled !== true ? null : `${config.targetHost}:${config.targetPort}`,
        forwardEnabled: config.forwardEnabled === true,
        sequenceWindow: 100,
        deviceEventLog: "logs/device-events-YYYY-MM-DD.jsonl",
      });
      resolve({
        socket,
        address,
        stats,
        close: () => new Promise((done) => {
          try { socket.close(() => done()); } catch { done(); }
        }),
      });
    });
  });
}

module.exports = { startUdpForwarder };
