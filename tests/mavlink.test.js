import test from "node:test";
import assert from "node:assert/strict";
import {
  isMavlinkDatagram,
  parseMavlinkTelemetry
} from "../src/telemetry/mavlink.js";

function crcAccumulate(byte, crc) {
  let tmp = byte ^ (crc & 0xff);
  tmp ^= (tmp << 4) & 0xff;

  return (
    ((crc >> 8) ^
      (tmp << 8) ^
      (tmp << 3) ^
      (tmp >> 4)) &
    0xffff
  );
}

function makeGlobalPositionIntV2({
  systemId = 1,
  lat = -353633515,
  lon = 1491652412,
  alt = 587000
} = {}) {
  const payload = Buffer.alloc(28);

  payload.writeUInt32LE(123456, 0);
  payload.writeInt32LE(lat, 4);
  payload.writeInt32LE(lon, 8);
  payload.writeInt32LE(alt, 12);
  payload.writeInt32LE(1000, 16);
  payload.writeInt16LE(0, 20);
  payload.writeInt16LE(0, 22);
  payload.writeInt16LE(0, 24);
  payload.writeUInt16LE(0, 26);

  const frame = Buffer.alloc(40);

  frame[0] = 0xfd;
  frame[1] = 28;
  frame[2] = 0;
  frame[3] = 0;
  frame[4] = 1;
  frame[5] = systemId;
  frame[6] = 1;
  frame[7] = 33;
  frame[8] = 0;
  frame[9] = 0;

  payload.copy(frame, 10);

  let crc = 0xffff;

  for (const byte of frame.subarray(1, 38)) {
    crc = crcAccumulate(byte, crc);
  }

  crc = crcAccumulate(104, crc);
  frame.writeUInt16LE(crc, 38);

  return frame;
}

test("detects MAVLink v2 datagram", () => {
  assert.equal(
    isMavlinkDatagram(makeGlobalPositionIntV2()),
    true
  );
});

test("decodes GLOBAL_POSITION_INT telemetry", () => {
  const rows = parseMavlinkTelemetry(
    makeGlobalPositionIntV2(),
    { droneId: "SITL-001" }
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].droneId, "SITL-001");
  assert.equal(rows[0].latitude, -35.3633515);
  assert.equal(rows[0].longitude, 149.1652412);
  assert.equal(rows[0].altitude, 587);
});

test("rejects invalid GLOBAL_POSITION_INT checksum", () => {
  const frame = makeGlobalPositionIntV2();

  frame[38] ^= 0xff;

  assert.throws(
    () => parseMavlinkTelemetry(frame),
    /checksum mismatch/
  );
});

test("ignores non-position MAVLink message", () => {
  const frame = makeGlobalPositionIntV2();

  frame[7] = 0;

  const rows = parseMavlinkTelemetry(frame);

  assert.equal(rows.length, 0);
});