import fs from "node:fs";
import path from "node:path";

function makeRow(event, fields = {}, level = "INFO") {
  return {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields
  };
}

function logDirectory() {
  return process.env.UPLINK_LOG_DIR?.trim() || "";
}

function appendJsonl(prefix, row) {
  const directory = logDirectory();

  if (!directory) {
    return;
  }

  fs.mkdirSync(directory, { recursive: true });

  const date = row.timestamp.slice(0, 10);
  const file = path.join(
    directory,
    `${prefix}-${date}.jsonl`
  );

  fs.appendFileSync(
    file,
    `${JSON.stringify(row)}\n`,
    "utf8"
  );
}

export function log(event, fields = {}, level = "INFO") {
  const row = makeRow(event, fields, level);

  process.stdout.write(
    `${JSON.stringify(row)}\n`
  );

  appendJsonl("uplink", row);
}

export function logDevice(event, fields = {}) {
  const enabled = /^(1|true|yes)$/i.test(
    process.env.UPLINK_DEVICE_LOG_ENABLED?.trim() || ""
  );

  if (!enabled) {
    return;
  }

  const row = makeRow(event, fields, "INFO");

  appendJsonl("device-events", row);
}
