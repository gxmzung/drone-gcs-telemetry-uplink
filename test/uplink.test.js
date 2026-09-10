"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const dgram = require("node:dgram");
const net = require("node:net");

const { startUdpForwarder } = require("../src/udp-forwarder");
const { startRtspProxy } = require("../src/rtsp-proxy");

const logger = {
  info() {},
  warn() {},
  error() {},
};

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
    },
    logger,
  );

  const received = new Promise((resolve) => {
    target.once("message", resolve);
  });

  const sender = dgram.createSocket("udp4");
  const payload = Buffer.from([0xfd, 0x01, 0x02, 0x03, 0x04]);

  sender.send(
    payload,
    forwarder.address.port,
    "127.0.0.1",
  );

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
