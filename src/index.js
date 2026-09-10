"use strict";

const { loadConfig, configPathFromArgs } = require("./config");
const { createLogger } = require("./logger");
const { startUdpForwarder } = require("./udp-forwarder");
const { startRtspProxy } = require("./rtsp-proxy");

async function main() {
  const configPath = configPathFromArgs(process.argv.slice(2));
  const config = loadConfig(configPath);
  const logger = createLogger(config.logging.directory);
  const services = [];

  logger.info("UPLINK_START", {
    node: process.version,
    platform: process.platform,
    config: configPath,
  });

  if (config.udp.enabled) {
    services.push(await startUdpForwarder(config.udp, logger));
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
      udp: udp
        ? {
            packets: udp.stats.packets,
            bytes: udp.stats.bytes,
            sendErrors: udp.stats.sendErrors,
            lastSource: udp.stats.lastSource,
            lastPacketAt: udp.stats.lastPacketAt,
          }
        : null,
      rtsp: rtsp
        ? {
            connections: rtsp.stats.connections,
            activeConnections: rtsp.stats.activeConnections,
            connectErrors: rtsp.stats.connectErrors,
            bytesFromClient: rtsp.stats.bytesFromClient,
            bytesFromSource: rtsp.stats.bytesFromSource,
          }
        : null,
    });
  }, config.logging.statusIntervalSec * 1000);

  timer.unref();

  async function shutdown(signal) {
    logger.info("UPLINK_STOP", { signal });
    clearInterval(timer);
    await Promise.allSettled(
      services.map((service) => service.close()),
    );
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
