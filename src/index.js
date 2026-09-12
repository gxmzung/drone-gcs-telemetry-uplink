"use strict";

const { loadConfig, configPathFromArgs } = require("./config");
const { createLogger } = require("./logger");
const { startUdpForwarder } = require("./udp-forwarder");
const { startRtspProxy } = require("./rtsp-proxy");
const { TelemetryPublisher } = require("./telemetry-publisher");

async function main() {
  const configPath = configPathFromArgs(process.argv.slice(2));
  const config = loadConfig(configPath);
  const logger = createLogger(config.logging.directory);
  const services = [];
  const publisher = new TelemetryPublisher(config.telemetry, logger);

  logger.info("UPLINK_START", {
    node: process.version,
    platform: process.platform,
    config: configPath,
  });

  publisher.start();

  if (config.udp.enabled) {
    services.push(await startUdpForwarder(config.udp, logger, {
      telemetry: config.telemetry,
      onTelemetry: (telemetry) => publisher.offer(telemetry),
    }));
  } else {
    logger.warn("UDP_DISABLED");
  }

  if (config.rtsp.enabled) {
    services.push(await startRtspProxy(config.rtsp, logger));
  } else {
    logger.warn("RTSP_DISABLED", {
      reason: "Set rtsp.enabled=true after the actual RTSP source host/port is confirmed",
    });
  }

  const timer = setInterval(() => {
    const udp = services.find((service) => service.socket);
    const rtsp = services.find((service) => service.server);

    logger.info("UPLINK_STATUS", {
      udp: udp ? {
        packets: udp.stats.packets,
        bytes: udp.stats.bytes,
        sendErrors: udp.stats.sendErrors,
        mavlinkFrames: udp.stats.mavlinkFrames,
        decodedFrames: udp.stats.decodedFrames,
        validatedMessageCounts: udp.stats.validatedMessageCounts,
        rejectedTelemetryFrames: udp.stats.rejectedTelemetryFrames,
        rejectedTelemetryMessageCounts: udp.stats.rejectedTelemetryMessageCounts,
        lastDecodedTelemetryAt: udp.stats.lastDecodedTelemetryAt,
        telemetryIdentity: udp.stats.telemetryIdentity,
        loopPacketsSuppressed: udp.stats.loopPacketsSuppressed,
        telemetryCount: udp.stats.telemetryCount,
        lastSource: udp.stats.lastSource,
        lastPacketAt: udp.stats.lastPacketAt,
        lastTelemetryAt: udp.stats.lastTelemetryAt,
        messageCounts: udp.stats.messageCounts,
        devices: udp.stats.devices,
        configuredTelemetryIdentity: config.telemetry.enabled ? { systemId: config.telemetry.systemId, componentId: config.telemetry.componentId } : null,
      } : null,
      telemetryPublisher: config.telemetry.enabled ? publisher.stats : null,
      rtsp: rtsp ? {
        connections: rtsp.stats.connections,
        activeConnections: rtsp.stats.activeConnections,
        connectErrors: rtsp.stats.connectErrors,
        bytesFromClient: rtsp.stats.bytesFromClient,
        bytesFromSource: rtsp.stats.bytesFromSource,
      } : null,
    });
  }, config.logging.statusIntervalSec * 1000);

  timer.unref();

  async function shutdown(signal) {
    logger.info("UPLINK_STOP", { signal });
    clearInterval(timer);
    publisher.stop();
    await Promise.allSettled(services.map((service) => service.close()));
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
