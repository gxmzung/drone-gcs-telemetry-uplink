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

module.exports = { parseMavlinkFrames, mavlinkDeviceId };
