"use strict";

const WINDOW_SIZE = 100;

function percentile95(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index];
}

function rounded(value) {
  return value == null ? null : Number(value.toFixed(3));
}

function summarizeWindow(deviceId, state, completedAt) {
  const received = state.slots.filter((slot) => slot.received).length;
  const expected = state.slots.length;
  const lost = expected - received;
  const periods = state.periodsMs;

  return {
    event: "DEVICE_SEQ_WINDOW",
    deviceId,
    windowSize: WINDOW_SIZE,
    expected,
    received,
    lost,
    lossPct: rounded(expected > 0 ? (lost / expected) * 100 : 0),
    firstSeq: state.slots[0]?.seq ?? null,
    lastSeq: state.slots.at(-1)?.seq ?? null,
    periodSamples: periods.length,
    periodAvgMs:
      periods.length > 0
        ? rounded(periods.reduce((sum, value) => sum + value, 0) / periods.length)
        : null,
    periodP95Ms: rounded(percentile95(periods)),
    periodMaxMs: rounded(periods.length > 0 ? Math.max(...periods) : null),
    completedAt,
  };
}

class DeviceSequenceMetrics {
  constructor() {
    this.states = new Map();
  }

  observe(frame, receivedAt = Date.now()) {
    const deviceId = `MAVLINK-SYS${frame.systemId}-COMP${frame.componentId}`;
    let state = this.states.get(deviceId);

    if (!state) {
      state = {
        lastSeq: null,
        lastReceivedAt: null,
        slots: [],
        periodsMs: [],
        completedWindows: 0,
      };
      this.states.set(deviceId, state);
    }

    const periodMs =
      state.lastReceivedAt == null
        ? null
        : Math.max(0, receivedAt - state.lastReceivedAt);

    const previousSeq = state.lastSeq;
    let delta = previousSeq == null
      ? 1
      : (frame.sequence - previousSeq + 256) % 256;

    const duplicate = previousSeq != null && delta === 0;
    const discontinuity = previousSeq != null && delta > 128;
    const completed = [];

    if (discontinuity) {
      state.slots = [];
      state.periodsMs = [];
      delta = 1;
    }

    const addSlot = (seq, isReceived, slotPeriodMs = null) => {
      state.slots.push({ seq, received: isReceived });

      if (isReceived && slotPeriodMs != null) {
        state.periodsMs.push(slotPeriodMs);
      }

      if (state.slots.length === WINDOW_SIZE) {
        const summary = summarizeWindow(
          deviceId,
          state,
          new Date(receivedAt).toISOString(),
        );
        state.completedWindows += 1;
        completed.push({
          ...summary,
          windowNumber: state.completedWindows,
        });
        state.slots = [];
        state.periodsMs = [];
      }
    };

    if (!duplicate) {
      if (previousSeq == null || discontinuity) {
        addSlot(frame.sequence, true, null);
      } else {
        for (let step = 1; step <= delta; step += 1) {
          const seq = (previousSeq + step) % 256;
          const isReceived = step === delta;
          addSlot(seq, isReceived, isReceived ? periodMs : null);
        }
      }

      state.lastSeq = frame.sequence;
      state.lastReceivedAt = receivedAt;
    }

    const partialExpected = state.slots.length;
    const partialReceived = state.slots.filter((slot) => slot.received).length;
    const partialLost = partialExpected - partialReceived;

    return {
      packet: {
        event: "DEVICE_PACKET",
        deviceId,
        mavlinkVersion: frame.version,
        systemId: frame.systemId,
        componentId: frame.componentId,
        messageId: frame.messageId,
        seq: frame.sequence,
        previousSeq,
        seqDelta: previousSeq == null ? null : delta,
        duplicate,
        discontinuity,
        periodMs: duplicate ? null : periodMs,
        receivedAt: new Date(receivedAt).toISOString(),
        window: {
          size: WINDOW_SIZE,
          expected: partialExpected,
          received: partialReceived,
          lost: partialLost,
          lossPct: rounded(
            partialExpected > 0
              ? (partialLost / partialExpected) * 100
              : 0,
          ),
        },
      },
      completed,
    };
  }

  snapshot() {
    return [...this.states.entries()].map(([deviceId, state]) => {
      const expected = state.slots.length;
      const received = state.slots.filter((slot) => slot.received).length;
      const lost = expected - received;

      return {
        deviceId,
        lastSeq: state.lastSeq,
        expected,
        received,
        lost,
        lossPct: rounded(expected > 0 ? (lost / expected) * 100 : 0),
        completedWindows: state.completedWindows,
      };
    });
  }
}

module.exports = { WINDOW_SIZE, DeviceSequenceMetrics, percentile95 };
