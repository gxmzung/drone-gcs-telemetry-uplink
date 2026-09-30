import { parseUdpTelemetry } from "./telemetry/normalize.js";
import {
  inspectMavlinkFrames,
  isMavlinkDatagram,
  parseMavlinkTelemetry
} from "./telemetry/mavlink.js";
import { MavlinkLinkQualityTracker } from "./telemetry/link-quality.js";
import { createUdpListener } from "./transport/udp-listener.js";
import { sendTelemetry } from "./transport/http-uplink.js";
import {
  log,
  logDevice
} from "./logging/logger.js";
import { startRtspProxy } from "./video/rtsp-proxy.js";

const udpHost = process.env.GCS_UDP_HOST?.trim() || "0.0.0.0";
const udpPort = Number.parseInt(process.env.GCS_UDP_PORT || "14551", 10);
const serverUrl =
  process.env.TELEMETRY_SERVER_URL?.trim() ||
  "http://127.0.0.1:18020/internal/v1/telemetry/drone";

const droneIdOverride =
  process.env.GCS_DRONE_ID?.trim() || "";

const rtspEnabled =
  /^(1|true|yes)$/i.test(
    process.env.RTSP_PROXY_ENABLED?.trim() || ""
  );

const rtspListenHost =
  process.env.RTSP_LISTEN_HOST?.trim() ||
  "0.0.0.0";

const rtspListenPort =
  Number.parseInt(
    process.env.RTSP_LISTEN_PORT || "9554",
    10
  );

const rtspSourceHost =
  process.env.RTSP_SOURCE_HOST?.trim() ||
  "127.0.0.1";

const rtspSourcePort =
  Number.parseInt(
    process.env.RTSP_SOURCE_PORT || "8554",
    10
  );

if (!Number.isInteger(udpPort) || udpPort < 1 || udpPort > 65535) {
  throw new Error("GCS_UDP_PORT must be a valid UDP port");
}

const latestPositions = new Map();
const latestGpsQuality = new Map();
const linkQualityTracker = new MavlinkLinkQualityTracker({ windowSize: 100 });
const lastQualityLogAt = new Map();

async function forwardTelemetry(
  telemetry,
  source,
  bytes,
  uplinkReceivedAt
) {
  log("TELEMETRY_RECEIVED", {
    droneId: telemetry.droneId,
    source,
    bytes,
    latitude: telemetry.latitude,
    longitude: telemetry.longitude,
    altitude: telemetry.altitude,
    gpsFixType: telemetry.gpsFixType,
    satellitesVisible: telemetry.satellitesVisible,
    hdop: telemetry.hdop,
    vdop: telemetry.vdop,
    horizontalAccuracy: telemetry.horizontalAccuracy,
    verticalAccuracy: telemetry.verticalAccuracy,
    packetLossPct: telemetry.packetLossPct,
    periodAvgMs: telemetry.periodAvgMs,
    periodP95Ms: telemetry.periodP95Ms,
    periodMaxMs: telemetry.periodMaxMs,
    qualityWindowExpected: telemetry.qualityWindowExpected,
    qualityWindowLost: telemetry.qualityWindowLost
  });

  const payload = {
    ...telemetry,

    pathEvidence: {
      uplinkReceivedAt:
        uplinkReceivedAt ||
        new Date().toISOString(),

      uplinkForwardStartedAt:
        new Date().toISOString(),

      uplinkSource: source,
      uplinkBytes: bytes,
      transport: "UDP_TO_HTTP"
    }
  };

  await sendTelemetry(payload, {
    url: serverUrl
  });
}

async function handleMavlinkTelemetry(
  event,
  source,
  bytes,
  uplinkReceivedAt
) {
  if (event.kind === "GPS_QUALITY") {
    const {
      kind,
      droneId,
      timestamp,
      ...quality
    } = event;

    latestGpsQuality.set(droneId, quality);

    const position = latestPositions.get(droneId);

    if (!position) {
      return;
    }

    await forwardTelemetry(
      {
        ...position,
        ...quality,
        timestamp
      },
      source,
      bytes,
      uplinkReceivedAt
    );

    return;
  }

  const {
    kind,
    ...position
  } = event;

  latestPositions.set(position.droneId, position);

  const quality =
    latestGpsQuality.get(position.droneId) ?? {};

  await forwardTelemetry(
    {
      ...quality,
      ...position
    },
    source,
    bytes,
    uplinkReceivedAt
  );
}

const socket = createUdpListener({
  host: udpHost,
  port: udpPort,

  async onPacket(message, remote) {
    const source = `${remote.address}:${remote.port}`;
    const uplinkReceivedAt =
      new Date().toISOString();

    try {
      if (isMavlinkDatagram(message)) {
        const receivedAtMs = Date.now();
        const frames = inspectMavlinkFrames(message);

        for (const frame of frames) {
          const quality = linkQualityTracker.observe(
            frame,
            receivedAtMs
          );

          logDevice("DEVICE_PACKET", {
            source,
            bytes: message.length,
            receivedAt:
              new Date(receivedAtMs).toISOString(),
            ...frame,
            ...(quality ?? {})
          });

          if (
            !quality ||
            quality.qualityWindowExpected < 2
          ) {
            continue;
          }

          const qualityKey = `${frame.systemId}:${frame.componentId}`;
          const lastLoggedAt = lastQualityLogAt.get(qualityKey) ?? 0;

          if (receivedAtMs - lastLoggedAt >= 5000) {
            lastQualityLogAt.set(qualityKey, receivedAtMs);
            log("LINK_QUALITY", quality);
          }
        }

        const rows = parseMavlinkTelemetry(message, {
          droneId: droneIdOverride
        });

        for (const telemetry of rows) {
          const linkQuality = linkQualityTracker.snapshot(
            telemetry.mavlinkSystemId,
            telemetry.mavlinkComponentId
          );

          await handleMavlinkTelemetry(
            {
              ...telemetry,
              ...(linkQuality ?? {})
            },
            source,
            message.length,
            uplinkReceivedAt
          );
        }

        return;
      }

      const telemetry = parseUdpTelemetry(message);

      await forwardTelemetry(
        telemetry,
        source,
        message.length,
        uplinkReceivedAt
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

let rtspProxy = null;

if (rtspEnabled) {
  if (
    !Number.isInteger(rtspListenPort) ||
    rtspListenPort < 1 ||
    rtspListenPort > 65535 ||
    !Number.isInteger(rtspSourcePort) ||
    rtspSourcePort < 1 ||
    rtspSourcePort > 65535
  ) {
    throw new Error(
      "RTSP ports must be valid TCP ports"
    );
  }

  rtspProxy = await startRtspProxy({
    listenHost: rtspListenHost,
    listenPort: rtspListenPort,
    sourceHost: rtspSourceHost,
    sourcePort: rtspSourcePort
  });
} else {
  log("RTSP_PROXY_DISABLED", {
    reason:
      "Set RTSP_PROXY_ENABLED=true after the actual RTSP source is confirmed"
  });
}

async function shutdown(signal) {
  log("GCS_DISCONNECTED", { signal });

  const tasks = [
    new Promise((resolve) => {
      try {
        socket.close(() => resolve());
      } catch {
        resolve();
      }
    })
  ];

  if (rtspProxy) {
    tasks.push(rtspProxy.close());
  }

  await Promise.allSettled(tasks);
  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
