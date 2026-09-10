"use strict";

const dgram = require("node:dgram");
const { parseMavlinkFrames } = require("./mavlink");
const { DeviceSequenceMetrics } = require("./device-metrics");

function startUdpForwarder(config, logger) {
  const socket = dgram.createSocket("udp4");
  const deviceMetrics = new DeviceSequenceMetrics();

  const stats = {
    packets: 0,
    bytes: 0,
    sendErrors: 0,
    mavlinkFrames: 0,
    completedSeqWindows: 0,
    lastSource: null,
    lastPacketAt: null,
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
      const observation = deviceMetrics.observe(frame, now);

      logger.device("DEVICE_PACKET", observation.packet);

      for (const summary of observation.completed) {
        stats.completedSeqWindows += 1;
        logger.device("DEVICE_SEQ_WINDOW", summary);
        logger.info("DEVICE_SEQ_WINDOW", summary);
      }
    }

    stats.devices = deviceMetrics.snapshot();

    socket.send(
      message,
      config.targetPort,
      config.targetHost,
      (error) => {
        if (error) {
          stats.sendErrors += 1;
          logger.error("UDP_SEND_FAILED", {
            error: error.message,
            target: `${config.targetHost}:${config.targetPort}`,
          });
        }
      },
    );
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
        target: `${config.targetHost}:${config.targetPort}`,
        sequenceWindow: 100,
        deviceEventLog: "logs/device-events-YYYY-MM-DD.jsonl",
      });

      resolve({
        socket,
        address,
        stats,
        close: () =>
          new Promise((done) => {
            try {
              socket.close(() => done());
            } catch {
              done();
            }
          }),
      });
    });
  });
}

module.exports = { startUdpForwarder };
