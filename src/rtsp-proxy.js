"use strict";

const net = require("node:net");

function startRtspProxy(config, logger) {
  const stats = {
    connections: 0,
    activeConnections: 0,
    bytesFromClient: 0,
    bytesFromSource: 0,
    connectErrors: 0,
  };

  const server = net.createServer((client) => {
    stats.connections += 1;
    stats.activeConnections += 1;

    const clientName = `${client.remoteAddress}:${client.remotePort}`;
    const upstream = net.createConnection({
      host: config.sourceHost,
      port: config.sourcePort,
    });

    logger.info("RTSP_CLIENT_CONNECTED", {
      client: clientName,
      source: `${config.sourceHost}:${config.sourcePort}`,
    });

    client.on("data", (chunk) => {
      stats.bytesFromClient += chunk.length;
    });
    upstream.on("data", (chunk) => {
      stats.bytesFromSource += chunk.length;
    });

    upstream.on("connect", () => {
      logger.info("RTSP_SOURCE_CONNECTED", {
        source: `${config.sourceHost}:${config.sourcePort}`,
      });
    });

    upstream.on("error", (error) => {
      stats.connectErrors += 1;
      logger.error("RTSP_SOURCE_ERROR", {
        error: error.message,
        source: `${config.sourceHost}:${config.sourcePort}`,
      });
      client.destroy();
    });

    client.on("error", (error) => {
      logger.warn("RTSP_CLIENT_ERROR", {
        error: error.message,
        client: clientName,
      });
      upstream.destroy();
    });

    const cleanup = () => {
      if (stats.activeConnections > 0) stats.activeConnections -= 1;
    };

    client.once("close", cleanup);
    client.pipe(upstream);
    upstream.pipe(client);
  });

  server.on("error", (error) => {
    logger.error("RTSP_PROXY_ERROR", { error: error.message });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.listenPort, config.listenHost, () => {
      server.removeListener("error", reject);
      const address = server.address();
      logger.info("RTSP_PROXY_LISTENING", {
        listen: `${address.address}:${address.port}`,
        source: `${config.sourceHost}:${config.sourcePort}`,
        transport: "RTSP-over-TCP/interleaved",
      });

      resolve({
        server,
        address,
        stats,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

module.exports = { startRtspProxy };
