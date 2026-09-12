"use strict";

const fs = require("node:fs");
const path = require("node:path");

function isPort(value) {
  return Number.isInteger(value) && value >= 0 && value <= 65535;
}

function requireHost(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty host`);
  }
  return value.trim();
}

function positiveInt(value, fallback, minimum = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum
    ? Math.floor(parsed)
    : fallback;
}

function loadConfig(filePath) {
  const absolute = path.resolve(filePath);
  const raw = fs.readFileSync(absolute, "utf8").replace(/^\uFEFF/, "");
  const config = JSON.parse(raw);

  if (!config.udp || !config.rtsp || !config.logging) {
    throw new Error("config requires udp, rtsp and logging sections");
  }

  const telemetryConfig = config.telemetry ?? {};
  const normalized = {
    udp: {
      enabled: config.udp.enabled !== false,
      forwardEnabled: config.udp.forwardEnabled === true,
      listenHost: requireHost(config.udp.listenHost, "udp.listenHost"),
      listenPort: Number(config.udp.listenPort),
      targetHost: requireHost(config.udp.targetHost, "udp.targetHost"),
      targetPort: Number(config.udp.targetPort),
    },
    rtsp: {
      enabled: config.rtsp.enabled === true,
      listenHost: requireHost(config.rtsp.listenHost, "rtsp.listenHost"),
      listenPort: Number(config.rtsp.listenPort),
      sourceHost: requireHost(config.rtsp.sourceHost, "rtsp.sourceHost"),
      sourcePort: Number(config.rtsp.sourcePort),
    },
    telemetry: {
      enabled: telemetryConfig.enabled === true,
      systemId: positiveInt(telemetryConfig.systemId, 1),
      componentId: positiveInt(telemetryConfig.componentId, 1),
      endpoint: typeof telemetryConfig.endpoint === "string" && telemetryConfig.endpoint.trim()
        ? telemetryConfig.endpoint.trim()
        : "http://127.0.0.1:18020/api/v1/dashboard/telemetry/drone",
      assetId: typeof telemetryConfig.assetId === "string" && telemetryConfig.assetId.trim()
        ? telemetryConfig.assetId.trim()
        : "MD1000-01",
      eventId: typeof telemetryConfig.eventId === "string" && telemetryConfig.eventId.trim()
        ? telemetryConfig.eventId.trim()
        : null,
      assetType: typeof telemetryConfig.assetType === "string" && telemetryConfig.assetType.trim()
        ? telemetryConfig.assetType.trim()
        : "UAV",
      intervalMs: positiveInt(telemetryConfig.intervalMs, 1000, 100),
      timeoutMs: positiveInt(telemetryConfig.timeoutMs, 3000, 100),
    },
    logging: {
      directory: typeof config.logging.directory === "string" && config.logging.directory.trim()
        ? config.logging.directory.trim()
        : "logs",
      statusIntervalSec: Math.max(1, Number(config.logging.statusIntervalSec) || 5),
    },
  };

  for (const [name, port] of [
    ["udp.listenPort", normalized.udp.listenPort],
    ["udp.targetPort", normalized.udp.targetPort],
    ["rtsp.listenPort", normalized.rtsp.listenPort],
    ["rtsp.sourcePort", normalized.rtsp.sourcePort],
  ]) {
    if (!isPort(port)) throw new Error(`${name} must be 0..65535`);
  }

  if (normalized.telemetry.enabled) {
    const url = new URL(normalized.telemetry.endpoint);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('telemetry.endpoint must be an HTTP(S) URL without credentials');
    if (!normalized.telemetry.eventId) throw new Error('telemetry.eventId is required when publishing');
  }
  if (normalized.telemetry.systemId>255 || normalized.telemetry.componentId>255) throw new Error('MAVLink identity must be 1..255');
  return normalized;
}

function configPathFromArgs(argv) {
  const index = argv.indexOf("--config");
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return "config.json";
}

module.exports = { loadConfig, configPathFromArgs };
