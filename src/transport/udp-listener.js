import dgram from "node:dgram";
import { log } from "../logging/logger.js";

export function createUdpListener({ host, port, onPacket }) {
  const socket = dgram.createSocket("udp4");

  socket.on("message", (message, remote) => {
    void Promise.resolve(onPacket(message, remote)).catch((error) => {
      log(
        "TELEMETRY_REJECTED",
        {
          source: `${remote.address}:${remote.port}`,
          error: error instanceof Error ? error.message : String(error)
        },
        "WARN"
      );
    });
  });

  socket.on("error", (error) => {
    log("GCS_SOCKET_ERROR", { error: error.message }, "ERROR");
  });

  socket.bind(port, host, () => {
    const address = socket.address();

    log("GCS_CONNECTED", {
      protocol: "UDP",
      host: address.address,
      port: address.port
    });
  });

  return socket;
}
