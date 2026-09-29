const MAVLINK_V1_MAGIC = 0xfe;
const MAVLINK_V2_MAGIC = 0xfd;

const GPS_RAW_INT_ID = 24;
const GPS_RAW_INT_CRC_EXTRA = 24;
const GLOBAL_POSITION_INT_ID = 33;
const GLOBAL_POSITION_INT_CRC_EXTRA = 104;

const UNKNOWN_UINT16 = 0xffff;
const UNKNOWN_UINT8 = 0xff;

function x25Accumulate(byte, crc) {
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

function x25Checksum(bytes, crcExtra) {
  let crc = 0xffff;

  for (const byte of bytes) {
    crc = x25Accumulate(byte, crc);
  }

  return x25Accumulate(crcExtra, crc);
}

function readFrame(buffer, offset) {
  const magic = buffer[offset];

  if (magic !== MAVLINK_V1_MAGIC && magic !== MAVLINK_V2_MAGIC) {
    return null;
  }

  if (offset + 2 > buffer.length) {
    throw new Error("incomplete MAVLink header");
  }

  const payloadLength = buffer[offset + 1];

  if (magic === MAVLINK_V1_MAGIC) {
    const frameLength = 8 + payloadLength;

    if (offset + frameLength > buffer.length) {
      throw new Error("incomplete MAVLink v1 frame");
    }

    return {
      version: 1,
      sequence: buffer[offset + 2],
      offset,
      frameLength,
      payloadLength,
      systemId: buffer[offset + 3],
      componentId: buffer[offset + 4],
      messageId: buffer[offset + 5],
      payloadOffset: offset + 6,
      checksumOffset: offset + 6 + payloadLength
    };
  }

  if (offset + 10 > buffer.length) {
    throw new Error("incomplete MAVLink v2 header");
  }

  const incompatFlags = buffer[offset + 2];
  const signed = (incompatFlags & 0x01) !== 0;
  const signatureLength = signed ? 13 : 0;
  const frameLength = 12 + payloadLength + signatureLength;

  if (offset + frameLength > buffer.length) {
    throw new Error("incomplete MAVLink v2 frame");
  }

  const messageId =
    buffer[offset + 7] |
    (buffer[offset + 8] << 8) |
    (buffer[offset + 9] << 16);

  return {
    version: 2,
    sequence: buffer[offset + 4],
    offset,
    frameLength,
    payloadLength,
    systemId: buffer[offset + 5],
    componentId: buffer[offset + 6],
    messageId,
    payloadOffset: offset + 10,
    checksumOffset: offset + 10 + payloadLength
  };
}

function verifyChecksum(buffer, frame, crcExtra, messageName) {
  const calculated = x25Checksum(
    buffer.subarray(frame.offset + 1, frame.checksumOffset),
    crcExtra
  );

  const received = buffer.readUInt16LE(frame.checksumOffset);

  if (calculated !== received) {
    throw new Error(
      `${messageName} checksum mismatch: expected ${received}, calculated ${calculated}`
    );
  }
}

function droneIdFor(frame, override) {
  return override?.trim() || `mavlink-${frame.systemId}`;
}

function decodeGlobalPositionInt(buffer, frame, droneIdOverride) {
  if (frame.payloadLength < 16) {
    throw new Error(
      `GLOBAL_POSITION_INT position payload too short: ${frame.payloadLength}`
    );
  }

  verifyChecksum(
    buffer,
    frame,
    GLOBAL_POSITION_INT_CRC_EXTRA,
    "GLOBAL_POSITION_INT"
  );

  const p = frame.payloadOffset;

  const latitude = buffer.readInt32LE(p + 4) / 1e7;
  const longitude = buffer.readInt32LE(p + 8) / 1e7;
  const altitude = buffer.readInt32LE(p + 12) / 1000;

  if (
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(altitude)
  ) {
    throw new Error("GLOBAL_POSITION_INT contains invalid coordinates");
  }

  return {
    kind: "POSITION",
    droneId: droneIdFor(frame, droneIdOverride),
    timestamp: new Date().toISOString(),
    latitude,
    longitude,
    altitude,
    positionSource: "GLOBAL_POSITION_INT(33)",
    mavlinkVersion: frame.version,
    mavlinkSystemId: frame.systemId,
    mavlinkComponentId: frame.componentId,
    mavlinkSequence: frame.sequence,
    mavlinkMessageId: frame.messageId
  };
}

function decodeGpsRawInt(buffer, frame, droneIdOverride) {
  if (frame.payloadLength < 30) {
    throw new Error(
      `GPS_RAW_INT payload too short: ${frame.payloadLength}`
    );
  }

  verifyChecksum(
    buffer,
    frame,
    GPS_RAW_INT_CRC_EXTRA,
    "GPS_RAW_INT"
  );

  const p = frame.payloadOffset;

  const eph = buffer.readUInt16LE(p + 20);
  const epv = buffer.readUInt16LE(p + 22);
  const fixType = buffer[p + 28];
  const satellitesVisible = buffer[p + 29];

  const telemetry = {
    kind: "GPS_QUALITY",
    droneId: droneIdFor(frame, droneIdOverride),
    timestamp: new Date().toISOString(),
    gpsFixType: fixType,
    mavlinkVersion: frame.version,
    mavlinkSystemId: frame.systemId,
    mavlinkComponentId: frame.componentId,
    mavlinkSequence: frame.sequence,
    mavlinkMessageId: frame.messageId
  };

  if (satellitesVisible !== UNKNOWN_UINT8) {
    telemetry.satellitesVisible = satellitesVisible;
  }

  if (eph !== UNKNOWN_UINT16) {
    telemetry.hdop = eph / 100;
  }

  if (epv !== UNKNOWN_UINT16) {
    telemetry.vdop = epv / 100;
  }

  // MAVLink 2 extension fields
  // h_acc: payload offset 34, millimetres
  if (frame.payloadLength >= 38) {
    telemetry.horizontalAccuracy =
      buffer.readUInt32LE(p + 34) / 1000;
  }

  // v_acc: payload offset 38, millimetres
  if (frame.payloadLength >= 42) {
    telemetry.verticalAccuracy =
      buffer.readUInt32LE(p + 38) / 1000;
  }

  return telemetry;
}


export function inspectMavlinkFrames(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("MAVLink input must be a Buffer");
  }

  const frames = [];
  let offset = 0;

  while (offset < buffer.length) {
    const magic = buffer[offset];

    if (magic !== MAVLINK_V1_MAGIC && magic !== MAVLINK_V2_MAGIC) {
      offset += 1;
      continue;
    }

    const frame = readFrame(buffer, offset);

    if (!frame) {
      offset += 1;
      continue;
    }

    frames.push({
      version: frame.version,
      sequence: frame.sequence,
      systemId: frame.systemId,
      componentId: frame.componentId,
      messageId: frame.messageId,
      frameLength: frame.frameLength
    });

    offset += frame.frameLength;
  }

  return frames;
}

export function parseMavlinkTelemetry(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("MAVLink input must be a Buffer");
  }

  const telemetry = [];
  let offset = 0;

  while (offset < buffer.length) {
    const magic = buffer[offset];

    if (magic !== MAVLINK_V1_MAGIC && magic !== MAVLINK_V2_MAGIC) {
      offset += 1;
      continue;
    }

    const frame = readFrame(buffer, offset);

    if (!frame) {
      offset += 1;
      continue;
    }

    let decoded = null;

    if (frame.messageId === GLOBAL_POSITION_INT_ID) {
      decoded = decodeGlobalPositionInt(
        buffer,
        frame,
        options.droneId
      );
    } else if (frame.messageId === GPS_RAW_INT_ID) {
      decoded = decodeGpsRawInt(
        buffer,
        frame,
        options.droneId
      );
    }

    if (decoded) {
      telemetry.push(decoded);
    }

    offset += frame.frameLength;
  }

  return telemetry;
}

export function isMavlinkDatagram(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length > 0 &&
    (buffer[0] === MAVLINK_V1_MAGIC ||
      buffer[0] === MAVLINK_V2_MAGIC)
  );
}
