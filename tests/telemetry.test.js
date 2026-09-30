import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTelemetry,
  parseUdpTelemetry
} from "../src/telemetry/normalize.js";

test("normalizes valid telemetry", () => {
  const result = normalizeTelemetry({
    droneId: "drone-01",
    timestamp: "2026-09-22T09:45:00+09:00",
    latitude: 36.3504,
    longitude: 127.3845,
    altitude: 120.5
  });

  assert.equal(result.droneId, "drone-01");
  assert.equal(result.latitude, 36.3504);
  assert.equal(result.longitude, 127.3845);
  assert.equal(result.altitude, 120.5);
});

test("parses UDP JSON telemetry", () => {
  const result = parseUdpTelemetry(
    Buffer.from(
      JSON.stringify({
        droneId: "drone-02",
        timestamp: "2026-09-22T09:46:00+09:00",
        latitude: 36.35,
        longitude: 127.38,
        altitude: 95
      })
    )
  );

  assert.equal(result.droneId, "drone-02");
});

test("rejects invalid coordinates", () => {
  assert.throws(
    () =>
      normalizeTelemetry({
        droneId: "drone-03",
        timestamp: new Date().toISOString(),
        latitude: 100,
        longitude: 127,
        altitude: 10
      }),
    /latitude/
  );
});

test("rejects unknown UDP format", () => {
  assert.throws(
    () => parseUdpTelemetry(Buffer.from([0xfd, 0x00, 0x01])),
    /unsupported UDP payload/
  );
});
