function round(value) {
  return value == null ? null : Number(value.toFixed(3));
}

function percentile95(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index];
}

function deviceKey(systemId, componentId) {
  return `${systemId}:${componentId}`;
}

export class MavlinkLinkQualityTracker {
  constructor({ windowSize = 100 } = {}) {
    if (!Number.isInteger(windowSize) || windowSize < 2) {
      throw new Error("windowSize must be an integer >= 2");
    }

    this.windowSize = windowSize;
    this.states = new Map();
  }

  observe(frame, receivedAtMs = Date.now()) {
    if (
      !frame ||
      !Number.isInteger(frame.systemId) ||
      !Number.isInteger(frame.componentId) ||
      !Number.isInteger(frame.sequence)
    ) {
      throw new Error("invalid MAVLink frame metadata");
    }

    const key = deviceKey(frame.systemId, frame.componentId);
    let state = this.states.get(key);

    if (!state) {
      state = {
        systemId: frame.systemId,
        componentId: frame.componentId,
        lastSeq: null,
        lastReceivedAtMs: null,
        slots: []
      };
      this.states.set(key, state);
    }

    const previousSeq = state.lastSeq;
    let delta =
      previousSeq == null
        ? 1
        : (frame.sequence - previousSeq + 256) % 256;

    if (previousSeq != null && delta === 0) {
      return this.snapshot(frame.systemId, frame.componentId);
    }

    // A large backwards jump is more likely a stream restart or out-of-order
    // packet than 129+ consecutive losses. Start a new measurement window.
    if (previousSeq != null && delta > 128) {
      state.slots = [];
      state.lastReceivedAtMs = null;
      delta = 1;
    }

    if (previousSeq != null && delta > 1) {
      for (let offset = 1; offset < delta; offset += 1) {
        state.slots.push({
          sequence: (previousSeq + offset) % 256,
          received: false,
          periodMs: null
        });
      }
    }

    const periodMs =
      state.lastReceivedAtMs == null
        ? null
        : Math.max(0, receivedAtMs - state.lastReceivedAtMs);

    state.slots.push({
      sequence: frame.sequence,
      received: true,
      periodMs
    });

    if (state.slots.length > this.windowSize) {
      state.slots.splice(0, state.slots.length - this.windowSize);
    }

    state.lastSeq = frame.sequence;
    state.lastReceivedAtMs = receivedAtMs;

    return this.snapshot(frame.systemId, frame.componentId);
  }

  snapshot(systemId, componentId) {
    const state = this.states.get(deviceKey(systemId, componentId));

    if (!state) return null;

    const expected = state.slots.length;
    const received = state.slots.filter((slot) => slot.received).length;
    const lost = expected - received;
    const periods = state.slots
      .map((slot) => slot.periodMs)
      .filter((value) => value != null);

    return {
      mavlinkSystemId: state.systemId,
      mavlinkComponentId: state.componentId,
      mavlinkSequence: state.lastSeq,
      qualityWindowExpected: expected,
      qualityWindowReceived: received,
      qualityWindowLost: lost,
      packetLossPct:
        expected > 0 ? round((lost / expected) * 100) : null,
      periodAvgMs:
        periods.length > 0
          ? round(periods.reduce((sum, value) => sum + value, 0) / periods.length)
          : null,
      periodP95Ms: round(percentile95(periods)),
      periodMaxMs: round(periods.length > 0 ? Math.max(...periods) : null)
    };
  }
}
