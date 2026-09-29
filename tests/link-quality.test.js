import test from "node:test";
import assert from "node:assert/strict";
import { MavlinkLinkQualityTracker } from "../src/telemetry/link-quality.js";

function frame(sequence, systemId = 1, componentId = 1) {
  return { sequence, systemId, componentId };
}

test("tracks rolling packet loss and receive periods", () => {
  const tracker = new MavlinkLinkQualityTracker({ windowSize: 100 });

  tracker.observe(frame(10), 1000);
  tracker.observe(frame(11), 1060);
  const quality = tracker.observe(frame(13), 1130);

  assert.equal(quality.qualityWindowExpected, 4);
  assert.equal(quality.qualityWindowReceived, 3);
  assert.equal(quality.qualityWindowLost, 1);
  assert.equal(quality.packetLossPct, 25);
  assert.equal(quality.periodAvgMs, 65);
  assert.equal(quality.periodP95Ms, 70);
  assert.equal(quality.periodMaxMs, 70);
});

test("handles MAVLink sequence wrap-around without false loss", () => {
  const tracker = new MavlinkLinkQualityTracker();

  tracker.observe(frame(254), 1000);
  tracker.observe(frame(255), 1050);
  const quality = tracker.observe(frame(0), 1100);

  assert.equal(quality.qualityWindowExpected, 3);
  assert.equal(quality.qualityWindowLost, 0);
  assert.equal(quality.packetLossPct, 0);
});

test("resets measurement window on large backwards discontinuity", () => {
  const tracker = new MavlinkLinkQualityTracker();

  tracker.observe(frame(100), 1000);
  tracker.observe(frame(101), 1100);
  const quality = tracker.observe(frame(20), 1200);

  assert.equal(quality.qualityWindowExpected, 1);
  assert.equal(quality.qualityWindowReceived, 1);
  assert.equal(quality.qualityWindowLost, 0);
});

test("ignores duplicate sequence numbers", () => {
  const tracker = new MavlinkLinkQualityTracker();

  tracker.observe(frame(42), 1000);
  const quality = tracker.observe(frame(42), 1200);

  assert.equal(quality.qualityWindowExpected, 1);
  assert.equal(quality.periodAvgMs, null);
});
