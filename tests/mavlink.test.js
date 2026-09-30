import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectMavlinkFrames,
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

function finalizeV2Frame(frame, crcExtra) {
  let crc = 0xffff;
  const checksumOffset = frame.length - 2;

  for (const byte of frame.subarray(1, checksumOffset)) {
    crc = crcAccumulate(byte, crc);
  }

  crc = crcAccumulate(crcExtra, crc);
  frame.writeUInt16LE(crc, checksumOffset);

  return frame;
}

function makeGlobalPositionIntV2({
  systemId = 1,
  sequence = 1,
  lat = -353633515,
  lon = 1491652412,
  alt = 587000
} = {}) {
  const payload = Buffer.alloc(28);

  payload.writeUInt32LE(123456, 0);
  payload.writeInt32LE(lat, 4);
  payload.writeInt32LE(lon, 8);
  payload.writeInt32LE(alt, 12);

  const frame = Buffer.alloc(40);

  frame[0] = 0xfd;
  frame[1] = payload.length;
  frame[4] = sequence;
  frame[5] = systemId;
  frame[6] = 1;
  frame[7] = 33;

  payload.copy(frame, 10);

  return finalizeV2Frame(frame, 104);
}

function makeGpsRawIntV2({
  systemId = 1,
  sequence = 1,
  fixType = 6,
  satellitesVisible = 18,
  eph = 85,
  epv = 120,
  horizontalAccuracyMm = 350,
  verticalAccuracyMm = 650
} = {}) {
  const payload = Buffer.alloc(52);

  payload.writeBigUInt64LE(123456789n, 0);
  payload.writeInt32LE(-353633515, 8);
  payload.writeInt32LE(1491652412, 12);
  payload.writeInt32LE(587000, 16);

  payload.writeUInt16LE(eph, 20);
  payload.writeUInt16LE(epv, 22);
  payload.writeUInt16LE(0, 24);
  payload.writeUInt16LE(0, 26);

  payload[28] = fixType;
  payload[29] = satellitesVisible;

  payload.writeInt32LE(588000, 30);
  payload.writeUInt32LE(horizontalAccuracyMm, 34);
  payload.writeUInt32LE(verticalAccuracyMm, 38);

  const frame = Buffer.alloc(64);

  frame[0] = 0xfd;
  frame[1] = payload.length;
  frame[4] = sequence;
  frame[5] = systemId;
  frame[6] = 1;
  frame[7] = 24;

  payload.copy(frame, 10);

  return finalizeV2Frame(frame, 24);
}


test("inspects MAVLink frame sequence metadata", () => {
  const frame = makeGlobalPositionIntV2({ systemId: 7, sequence: 42 });
  const rows = inspectMavlinkFrames(frame);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].version, 2);
  assert.equal(rows[0].systemId, 7);
  assert.equal(rows[0].componentId, 1);
  assert.equal(rows[0].sequence, 42);
  assert.equal(rows[0].messageId, 33);
});

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
  assert.equal(rows[0].kind, "POSITION");
  assert.equal(rows[0].droneId, "SITL-001");
  assert.equal(rows[0].latitude, -35.3633515);
  assert.equal(rows[0].longitude, 149.1652412);
  assert.equal(rows[0].altitude, 587);
  assert.equal(
    rows[0].positionSource,
    "GLOBAL_POSITION_INT(33)"
  );
  assert.equal(rows[0].mavlinkVersion, 2);
  assert.equal(rows[0].mavlinkSequence, 1);
});

test("decodes GPS_RAW_INT quality telemetry", () => {
  const rows = parseMavlinkTelemetry(
    makeGpsRawIntV2(),
    { droneId: "SITL-001" }
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "GPS_QUALITY");
  assert.equal(rows[0].droneId, "SITL-001");
  assert.equal(rows[0].gpsFixType, 6);
  assert.equal(rows[0].satellitesVisible, 18);
  assert.equal(rows[0].hdop, 0.85);
  assert.equal(rows[0].vdop, 1.2);
  assert.equal(rows[0].horizontalAccuracy, 0.35);
  assert.equal(rows[0].verticalAccuracy, 0.65);
});

test("supports GPS_RAW_INT without MAVLink 2 extension fields", () => {
  const full = makeGpsRawIntV2();

  const payload = full.subarray(10, 40);
  const frame = Buffer.alloc(42);

  full.copy(frame, 0, 0, 10);
  frame[1] = 30;
  payload.copy(frame, 10);

  finalizeV2Frame(frame, 24);

  const rows = parseMavlinkTelemetry(frame);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].gpsFixType, 6);
  assert.equal(rows[0].satellitesVisible, 18);
  assert.equal(rows[0].horizontalAccuracy, undefined);
  assert.equal(rows[0].verticalAccuracy, undefined);
});

test("rejects invalid GLOBAL_POSITION_INT checksum", () => {
  const frame = makeGlobalPositionIntV2();

  frame[38] ^= 0xff;

  assert.throws(
    () => parseMavlinkTelemetry(frame),
    /checksum mismatch/
  );
});

test("rejects invalid GPS_RAW_INT checksum", () => {
  const frame = makeGpsRawIntV2();

  frame[62] ^= 0xff;

  assert.throws(
    () => parseMavlinkTelemetry(frame),
    /checksum mismatch/
  );
});

test("ignores unsupported MAVLink message", () => {
  const frame = makeGlobalPositionIntV2();

  frame[7] = 0;

  const rows = parseMavlinkTelemetry(frame);

  assert.equal(rows.length, 0);
});
