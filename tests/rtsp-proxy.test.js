import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import {
  startRtspProxy
} from "../src/video/rtsp-proxy.js";

test(
  "RTSP TCP proxy relays bidirectional bytes",
  async () => {
    const source = net.createServer(
      (socket) => socket.pipe(socket)
    );

    await new Promise((resolve) => {
      source.listen(
        0,
        "127.0.0.1",
        resolve
      );
    });

    const sourceAddress = source.address();

    const proxy = await startRtspProxy({
      listenHost: "127.0.0.1",
      listenPort: 0,
      sourceHost: "127.0.0.1",
      sourcePort: sourceAddress.port
    });

    const client = net.createConnection({
      host: "127.0.0.1",
      port: proxy.address.port
    });

    await new Promise((resolve) => {
      client.once("connect", resolve);
    });

    const received = new Promise((resolve) => {
      client.once("data", resolve);
    });

    const request = Buffer.from(
      "OPTIONS rtsp://camera RTSP/1.0\r\n\r\n"
    );

    client.write(request);

    const response = await received;

    assert.equal(
      response.toString(),
      request.toString()
    );

    client.destroy();

    await proxy.close();

    await new Promise((resolve) => {
      source.close(resolve);
    });
  }
);
