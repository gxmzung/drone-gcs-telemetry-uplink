"use strict";

const dgram = require("node:dgram");

function startUdpForwarder(config, logger) {
  const socket = dgram.createSocket("udp4");
  const stats = {
    packets: 0,
    bytes: 0,
    sendErrors: 0,
    lastSource: null,
    lastPacketAt: null,
  };

  socket.on("message", (message, remote) => {
    stats.packets += 1;
    stats.bytes += message.length;
    stats.lastSource = `${remote.address}:${remote.port}`;
    stats.lastPacketAt = new Date().toISOString();

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
