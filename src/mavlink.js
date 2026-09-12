"use strict";

function parseMavlinkFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset < buffer.length) {
    const magic = buffer[offset];

    if (magic === 0xfd) {
      if (offset + 12 > buffer.length) break;

      const payloadLength = buffer[offset + 1];
      const incompatFlags = buffer[offset + 2];
      const signed = (incompatFlags & 0x01) !== 0;
      const frameLength = 12 + payloadLength + (signed ? 13 : 0);

      if (offset + frameLength > buffer.length) break;

      frames.push({
        version: 2,
        sequence: buffer[offset + 4],
        systemId: buffer[offset + 5],
        componentId: buffer[offset + 6],
        messageId:
          buffer[offset + 7] |
          (buffer[offset + 8] << 8) |
          (buffer[offset + 9] << 16),
        offset,
        frameLength,
        payloadOffset: offset + 10,
        payloadLength,
        incompatFlags,
        signed,
      });

      offset += frameLength;
      continue;
    }

    if (magic === 0xfe) {
      if (offset + 8 > buffer.length) break;

      const payloadLength = buffer[offset + 1];
      const frameLength = 8 + payloadLength;

      if (offset + frameLength > buffer.length) break;

      frames.push({
        version: 1,
        sequence: buffer[offset + 2],
        systemId: buffer[offset + 3],
        componentId: buffer[offset + 4],
        messageId: buffer[offset + 5],
        offset,
        frameLength,
        payloadOffset: offset + 6,
        payloadLength,
        incompatFlags: 0,
        signed: false,
      });

      offset += frameLength;
      continue;
    }

    offset += 1;
  }

  return frames;
}

function mavlinkDeviceId(frame) {
  return `MAVLINK-SYS${frame.systemId}-COMP${frame.componentId}`;
}

// MAVLink common.xml wire lengths and CRC_EXTRA values.
// MAVLink 2 may truncate zero-filled trailing payload bytes down to one byte.
const DEFINITIONS = {
  0: { minLength: 9, maxLength: 9, crcExtra: 50 },
  1: { minLength: 31, maxLength: 31, crcExtra: 124 },
  24: { minLength: 30, maxLength: 52, crcExtra: 24 },
  30: { minLength: 28, maxLength: 28, crcExtra: 39 },
  33: { minLength: 28, maxLength: 28, crcExtra: 104 },
  42: { minLength: 2, maxLength: 18, crcExtra: 28 },
};

function crcX25(bytes, extra) {
  let crc = 0xffff;
  for (const byte of [...bytes, extra]) {
    let tmp = byte ^ (crc & 0xff);
    tmp ^= (tmp << 4) & 0xff;
    crc = ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff;
  }
  return crc;
}

function decodeMavlinkMessage(buffer, frame) {
  const definition = DEFINITIONS[frame.messageId];
  if (!definition || (frame.incompatFlags & ~0x01) !== 0 || frame.payloadLength < 1) return null;

  const { minLength, maxLength, crcExtra } = definition;
  if (frame.version === 1 && frame.payloadLength !== minLength) return null;
  if (frame.version === 2 && frame.payloadLength > maxLength) return null;

  const payloadEnd = frame.payloadOffset + frame.payloadLength;
  if (payloadEnd + 2 > buffer.length) return null;
  if (crcX25(buffer.subarray(frame.offset + 1, payloadEnd), crcExtra) !== buffer.readUInt16LE(payloadEnd)) return null;

  // CRC-validated MAVLink 2 payloads are zero-extended before field decoding.
  const b = Buffer.alloc(maxLength);
  buffer.copy(b, 0, frame.payloadOffset, Math.min(payloadEnd, frame.payloadOffset + maxLength));

  switch (frame.messageId) {
    case 0:
      return {
        type: "HEARTBEAT",
        customMode: b.readUInt32LE(0),
        vehicleType: b[4],
        autopilot: b[5],
        baseMode: b[6],
        mavlinkVersion: b[8],
      };
    case 1:
      return {
        type: "SYS_STATUS",
        voltageBatteryMv: b.readUInt16LE(14),
        batteryRemaining: b.readInt8(30),
      };
    case 24:
      return {
        type: "GPS_RAW_INT",
        fixType: b[28],
        satellitesVisible: b[29],
        // h_acc is a MAVLink 2 extension at payload offset 34. Partial transmission
        // is valid because MAVLink 2 trims only trailing zero bytes; zero-fill restores it.
        horizontalAccuracyMm:
          frame.version === 2 && frame.payloadLength > 34 ? b.readUInt32LE(34) : 0,
      };
    case 30:
      return {
        type: "ATTITUDE",
        rollRad: b.readFloatLE(4),
        pitchRad: b.readFloatLE(8),
        yawRad: b.readFloatLE(12),
      };
    case 33:
      return {
        type: "GLOBAL_POSITION_INT",
        bootMs: b.readUInt32LE(0),
        lat: b.readInt32LE(4),
        lon: b.readInt32LE(8),
        altMm: b.readInt32LE(12),
        relativeAltMm: b.readInt32LE(16),
        vxCms: b.readInt16LE(20),
        vyCms: b.readInt16LE(22),
        vzCms: b.readInt16LE(24),
        headingCdeg: b.readUInt16LE(26),
      };
    case 42:
      return {
        type: "MISSION_CURRENT",
        seq: b.readUInt16LE(0),
      };
    default:
      return null;
  }
}

module.exports = {
  parseMavlinkFrames,
  mavlinkDeviceId,
  decodeMavlinkMessage,
  crcX25,
};
