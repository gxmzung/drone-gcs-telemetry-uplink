"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const dgram = require("node:dgram");
const net = require("node:net");

const { parseMavlinkFrames } = require("../src/mavlink");
const { DeviceSequenceMetrics } = require("../src/device-metrics");
const { startUdpForwarder } = require("../src/udp-forwarder");
const { startRtspProxy } = require("../src/rtsp-proxy");

const logger = {
  info() {},
  warn() {},
  error() {},
  device() {},
};

test("MAVLink v2 sequence and device identity are parsed", () => {
  const packet = Buffer.from([
    0xfd, 0x00, 0x00, 0x00,
    0x2a, 0x01, 0x01,
    0x21, 0x00, 0x00,
    0x00, 0x00,
  ]);

  const frames = parseMavlinkFrames(packet);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].version, 2);
  assert.equal(frames[0].sequence, 42);
  assert.equal(frames[0].systemId, 1);
  assert.equal(frames[0].componentId, 1);
  assert.equal(frames[0].messageId, 33);
});

test("MAVLink v1 sequence is parsed", () => {
  const packet = Buffer.from([
    0xfe, 0x00, 0x09, 0x02, 0x03, 0x21, 0x00, 0x00,
  ]);

  const frames = parseMavlinkFrames(packet);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].version, 1);
  assert.equal(frames[0].sequence, 9);
  assert.equal(frames[0].systemId, 2);
  assert.equal(frames[0].componentId, 3);
  assert.equal(frames[0].messageId, 33);
});

test("100 sequence window measures loss and packet period", () => {
  const metrics = new DeviceSequenceMetrics();
  let completed = [];

  for (let seq = 0; seq <= 99; seq += 1) {
    if (seq === 50) continue;

    const result = metrics.observe(
      {
        version: 2,
        sequence: seq,
        systemId: 1,
        componentId: 1,
        messageId: 33,
      },
      seq * 1000,
    );

    completed = completed.concat(result.completed);
  }

  assert.equal(completed.length, 1);
  assert.equal(completed[0].windowSize, 100);
  assert.equal(completed[0].expected, 100);
  assert.equal(completed[0].received, 99);
  assert.equal(completed[0].lost, 1);
  assert.equal(completed[0].lossPct, 1);
  assert.equal(completed[0].periodMaxMs, 2000);
  assert.equal(completed[0].firstSeq, 0);
  assert.equal(completed[0].lastSeq, 99);
});

test("sequence wrap 255 to 0 is not treated as loss", () => {
  const metrics = new DeviceSequenceMetrics();

  metrics.observe(
    { version: 2, sequence: 255, systemId: 1, componentId: 1, messageId: 0 },
    0,
  );

  const result = metrics.observe(
    { version: 2, sequence: 0, systemId: 1, componentId: 1, messageId: 0 },
    1000,
  );

  assert.equal(result.packet.seqDelta, 1);
  assert.equal(result.packet.window.lost, 0);
});

test("UDP payload is forwarded without modification", async () => {
  const target = dgram.createSocket("udp4");
  await new Promise((resolve) => target.bind(0, "127.0.0.1", resolve));
  const targetPort = target.address().port;

  const forwarder = await startUdpForwarder(
    {
      listenHost: "127.0.0.1",
      listenPort: 0,
      targetHost: "127.0.0.1",
      targetPort,
      forwardEnabled: true,
    },
    logger,
  );

  const received = new Promise((resolve) => {
    target.once("message", resolve);
  });

  const sender = dgram.createSocket("udp4");
  const payload = Buffer.from([0xfd, 0x01, 0x02, 0x03, 0x04]);

  sender.send(payload, forwarder.address.port, "127.0.0.1");

  const actual = await received;
  assert.deepEqual(actual, payload);
  assert.equal(forwarder.stats.packets, 1);

  sender.close();
  target.close();
  await forwarder.close();
});

test("RTSP TCP proxy transports bidirectional bytes", async () => {
  const echo = net.createServer((socket) => socket.pipe(socket));
  await new Promise((resolve) => echo.listen(0, "127.0.0.1", resolve));
  const sourcePort = echo.address().port;

  const proxy = await startRtspProxy(
    {
      listenHost: "127.0.0.1",
      listenPort: 0,
      sourceHost: "127.0.0.1",
      sourcePort,
    },
    logger,
  );

  const client = net.createConnection({
    host: "127.0.0.1",
    port: proxy.address.port,
  });

  await new Promise((resolve) => client.once("connect", resolve));

  const echoed = new Promise((resolve) => {
    client.once("data", resolve);
  });

  client.write(Buffer.from("OPTIONS rtsp://test RTSP/1.0\r\n\r\n"));
  const response = await echoed;

  assert.equal(
    response.toString(),
    "OPTIONS rtsp://test RTSP/1.0\r\n\r\n",
  );

  client.destroy();
  await proxy.close();
  await new Promise((resolve) => echo.close(resolve));
});
