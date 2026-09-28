const MAVLINK_V1_MAGIC = 0xfe;
const MAVLINK_V2_MAGIC = 0xfd;

const GLOBAL_POSITION_INT_ID = 33;
const GLOBAL_POSITION_INT_CRC_EXTRA = 104;

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

function verifyGlobalPositionChecksum(buffer, frame) {
  const crcStart = frame.offset + 1;
  const crcEnd = frame.checksumOffset;

  const calculated = x25Checksum(
    buffer.subarray(crcStart, crcEnd),
    GLOBAL_POSITION_INT_CRC_EXTRA
  );

  const received = buffer.readUInt16LE(frame.checksumOffset);

  if (calculated !== received) {
    throw new Error(
      `GLOBAL_POSITION_INT checksum mismatch: expected ${received}, calculated ${calculated}`
    );
  }
}

function decodeGlobalPositionInt(buffer, frame, droneIdOverride) {
  if (frame.messageId !== GLOBAL_POSITION_INT_ID) {
    return null;
  }

  if (frame.payloadLength < 16) {
    throw new Error(
      `GLOBAL_POSITION_INT position payload too short: ${frame.payloadLength}`
    );
  }

  verifyGlobalPositionChecksum(buffer, frame);

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
    droneId:
      droneIdOverride?.trim() ||
      `mavlink-${frame.systemId}`,
    timestamp: new Date().toISOString(),
    latitude,
    longitude,
    altitude
  };
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

    const position = decodeGlobalPositionInt(
      buffer,
      frame,
      options.droneId
    );

    if (position) {
      telemetry.push(position);
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
