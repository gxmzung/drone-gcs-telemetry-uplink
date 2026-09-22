import { parseUdpTelemetry } from "./telemetry/normalize.js";
import { createUdpListener } from "./transport/udp-listener.js";
import { sendTelemetry } from "./transport/http-uplink.js";
import { log } from "./logging/logger.js";

const udpHost = process.env.GCS_UDP_HOST?.trim() || "0.0.0.0";
const udpPort = Number.parseInt(process.env.GCS_UDP_PORT || "14551", 10);
const serverUrl =
  process.env.TELEMETRY_SERVER_URL?.trim() ||
  "http://127.0.0.1:18020/internal/v1/telemetry/drone";

if (!Number.isInteger(udpPort) || udpPort < 1 || udpPort > 65535) {
  throw new Error("GCS_UDP_PORT must be a valid UDP port");
}

const socket = createUdpListener({
  host: udpHost,
  port: udpPort,
  async onPacket(message, remote) {
    const telemetry = parseUdpTelemetry(message);

    log("TELEMETRY_RECEIVED", {
      droneId: telemetry.droneId,
      source: `${remote.address}:${remote.port}`
    });

    await sendTelemetry(telemetry, {
      url: serverUrl
    });
  }
});

function shutdown(signal) {
  log("GCS_DISCONNECTED", { signal });

  socket.close(() => {
    process.exit(0);
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
