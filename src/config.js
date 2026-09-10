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

function loadConfig(filePath) {
  const absolute = path.resolve(filePath);
  const raw = fs.readFileSync(absolute, "utf8").replace(/^\uFEFF/, "");
  const config = JSON.parse(raw);

  if (!config.udp || !config.rtsp || !config.logging) {
    throw new Error("config requires udp, rtsp and logging sections");
  }

  const normalized = {
    udp: {
      enabled: config.udp.enabled !== false,
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
    logging: {
      directory:
        typeof config.logging.directory === "string" && config.logging.directory.trim()
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

  return normalized;
}

function configPathFromArgs(argv) {
  const index = argv.indexOf("--config");
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return "config.json";
}

module.exports = { loadConfig, configPathFromArgs };
