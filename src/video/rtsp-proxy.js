import net from "node:net";

import { log } from "../logging/logger.js";

export function startRtspProxy({
  listenHost = "0.0.0.0",
  listenPort = 9554,
  sourceHost = "127.0.0.1",
  sourcePort = 8554
}) {
  const stats = {
    connections: 0,
    activeConnections: 0,
    bytesFromClient: 0,
    bytesFromSource: 0,
    connectErrors: 0
  };

  const server = net.createServer((client) => {
    stats.connections += 1;
    stats.activeConnections += 1;

    const clientAddress =
      `${client.remoteAddress}:${client.remotePort}`;

    const upstream = net.createConnection({
      host: sourceHost,
      port: sourcePort
    });

    let closed = false;

    const markClosed = () => {
      if (closed) return;

      closed = true;
      stats.activeConnections = Math.max(
        0,
        stats.activeConnections - 1
      );
    };

    log("RTSP_CLIENT_CONNECTED", {
      client: clientAddress,
      source: `${sourceHost}:${sourcePort}`
    });

    client.on("data", (chunk) => {
      stats.bytesFromClient += chunk.length;
    });

    upstream.on("data", (chunk) => {
      stats.bytesFromSource += chunk.length;
    });

    upstream.on("connect", () => {
      log("RTSP_SOURCE_CONNECTED", {
        source: `${sourceHost}:${sourcePort}`
      });
    });

    upstream.on("error", (error) => {
      stats.connectErrors += 1;

      log(
        "RTSP_SOURCE_ERROR",
        {
          source: `${sourceHost}:${sourcePort}`,
          error: error.message
        },
        "ERROR"
      );

      client.destroy();
    });

    client.on("error", (error) => {
      log(
        "RTSP_CLIENT_ERROR",
        {
          client: clientAddress,
          error: error.message
        },
        "WARN"
      );

      upstream.destroy();
    });

    client.once("close", markClosed);
    upstream.once("close", markClosed);

    client.pipe(upstream);
    upstream.pipe(client);
  });

  server.on("error", (error) => {
    log(
      "RTSP_PROXY_ERROR",
      { error: error.message },
      "ERROR"
    );
  });

  return new Promise((resolve, reject) => {
    const initialError = (error) => {
      reject(error);
    };

    server.once("error", initialError);

    server.listen(
      listenPort,
      listenHost,
      () => {
        server.removeListener(
          "error",
          initialError
        );

        const address = server.address();

        log("RTSP_PROXY_LISTENING", {
          listen:
            `${address.address}:${address.port}`,
          source:
            `${sourceHost}:${sourcePort}`,
          transport:
            "RTSP_OVER_TCP"
        });

        resolve({
          server,
          address,
          stats,

          close() {
            return new Promise((done) => {
              server.close(() => done());
            });
          }
        });
      }
    );
  });
}
