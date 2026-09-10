"use strict";

const fs = require("node:fs");
const path = require("node:path");

function createLogger(directory) {
  const logDir = path.resolve(directory);
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(
    logDir,
    `uplink-${new Date().toISOString().slice(0, 10)}.log`,
  );

  function write(level, event, detail = {}) {
    const row = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...detail,
    };
    const line = JSON.stringify(row);
    console.log(line);
    fs.appendFileSync(logFile, line + "\n", "utf8");
  }

  return {
    info: (event, detail) => write("INFO", event, detail),
    warn: (event, detail) => write("WARN", event, detail),
    error: (event, detail) => write("ERROR", event, detail),
  };
}

module.exports = { createLogger };
