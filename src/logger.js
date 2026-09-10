"use strict";

const fs = require("node:fs");
const path = require("node:path");

function datePart() {
  return new Date().toISOString().slice(0, 10);
}

function createLogger(directory) {
  const logDir = path.resolve(directory);
  fs.mkdirSync(logDir, { recursive: true });

  function row(level, event, detail = {}) {
    return {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...detail,
    };
  }

  function append(prefix, value) {
    const file = path.join(logDir, `${prefix}-${datePart()}.jsonl`);
    fs.appendFileSync(file, JSON.stringify(value) + "\n", "utf8");
  }

  function write(level, event, detail = {}) {
    const value = row(level, event, detail);
    console.log(JSON.stringify(value));
    append("uplink", value);
  }

  function device(event, detail = {}) {
    const value = row("INFO", event, detail);
    append("device-events", value);
  }

  return {
    info: (event, detail) => write("INFO", event, detail),
    warn: (event, detail) => write("WARN", event, detail),
    error: (event, detail) => write("ERROR", event, detail),
    device,
  };
}

module.exports = { createLogger };
