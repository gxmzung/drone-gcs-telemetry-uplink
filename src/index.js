import { parseUdpTelemetry } from "./telemetry/normalize.js";
import {
  isMavlinkDatagram,
  parseMavlinkTelemetry
} from "./telemetry/mavlink.js";
import { createUdpListener } from "./transport/udp-listener.js";
import { sendTelemetry } from "./transport/http-uplink.js";
import { log } from "./logging/logger.js";

const udpHost = process.env.GCS_UDP_HOST?.trim() || "0.0.0.0";
const udpPort = Number.parseInt(process.env.GCS_UDP_PORT || "14551", 10);
const serverUrl =
  process.env.TELEMETRY_SERVER_URL?.trim() ||
  "http://127.0.0.1:18020/internal/v1/telemetry/drone";

const droneIdOverride =
  process.env.GCS_DRONE_ID?.trim() || "";

if (!Number.isInteger(udpPort) || udpPort < 1 || udpPort > 65535) {
  throw new Error("GCS_UDP_PORT must be a valid UDP port");
}

async function forwardTelemetry(telemetry, source, bytes) {
  log("TELEMETRY_RECEIVED", {
    droneId: telemetry.droneId,
    source,
    bytes,
    latitude: telemetry.latitude,
    longitude: telemetry.longitude,
    altitude: telemetry.altitude
  });

  await sendTelemetry(telemetry, {
    url: serverUrl
  });
}

const socket = createUdpListener({
  host: udpHost,
  port: udpPort,

  async onPacket(message, remote) {
    const source = `${remote.address}:${remote.port}`;

    try {
      if (isMavlinkDatagram(message)) {
        const rows = parseMavlinkTelemetry(message, {
          droneId: droneIdOverride
        });

        for (const telemetry of rows) {
          await forwardTelemetry(
            telemetry,
            source,
            message.length
          );
        }

        return;
      }

      const telemetry = parseUdpTelemetry(message);

      await forwardTelemetry(
        telemetry,
        source,
        message.length
      );
    } catch (error) {
      log(
        "UDP_PACKET_REJECTED",
        {
          source,
          bytes: message.length,
          firstByte:
            message.length > 0
              ? `0x${message[0]
                  .toString(16)
                  .padStart(2, "0")}`
              : null,
          error:
            error instanceof Error
              ? error.message
              : String(error)
        },
        "ERROR"
      );
    }
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