import test from "node:test";
import assert from "node:assert/strict";

import {
  createFailoverUplink,
  parseTelemetryServerUrls
} from "../src/transport/http-uplink.js";

const telemetry = {
  droneId:
    "FAILOVER-DRONE",

  timestamp:
    "2026-10-01T00:00:00.000Z",

  latitude:
    36.3504,

  longitude:
    127.3845,

  altitude:
    120
};

function ok() {
  return {
    ok: true,
    status: 202
  };
}

test(
  "복수 서버 주소를 읽고 중복을 제거한다",
  () => {
    assert.deepEqual(
      parseTelemetryServerUrls(
        "http://a.local/x,http://b.local/x;http://a.local/x",
        ""
      ),

      [
        "http://a.local/x",
        "http://b.local/x"
      ]
    );
  }
);

test(
  "Primary 정상 시 Primary만 사용한다",
  async () => {
    const calls = [];

    const uplink =
      createFailoverUplink({
        urls: [
          "http://primary.local/telemetry",
          "http://backup.local/telemetry"
        ],

        fetchImpl:
          async (url) => {
            calls.push(
              String(url)
            );

            return ok();
          }
      });

    await uplink.send(
      telemetry
    );

    assert.deepEqual(
      calls,
      [
        "http://primary.local/telemetry"
      ]
    );

    assert.equal(
      uplink.status()
        .activeRole,
      "PRIMARY"
    );
  }
);

test(
  "Primary 장애 시 Backup으로 자동전환한다",
  async () => {
    const calls = [];

    let clock =
      1000;

    const uplink =
      createFailoverUplink({
        urls: [
          "http://primary.local/telemetry",
          "http://backup.local/telemetry"
        ],

        now:
          () => clock,

        fetchImpl:
          async (url) => {
            const text =
              String(url);

            calls.push(text);

            if (
              text.includes(
                "primary"
              )
            ) {
              throw new Error(
                "primary down"
              );
            }

            clock += 25;

            return ok();
          }
      });

    await uplink.send(
      telemetry
    );

    assert.deepEqual(
      calls,
      [
        "http://primary.local/telemetry",
        "http://backup.local/telemetry"
      ]
    );

    assert.equal(
      uplink.status()
        .activeRole,
      "BACKUP_1"
    );

    assert.equal(
      uplink.status()
        .failoverCount,
      1
    );

    assert.equal(
      uplink.status()
        .lastSwitchDurationMs,
      25
    );
  }
);

test(
  "Backup 운용 중 Primary 복구 시 자동복귀한다",
  async () => {
    let clock = 0;
    let primaryUp = false;

    const calls = [];

    const uplink =
      createFailoverUplink({
        urls: [
          "http://primary.local/telemetry",
          "http://backup.local/telemetry"
        ],

        failbackProbeEveryMs:
          1000,

        now:
          () => clock,

        fetchImpl:
          async (url) => {
            const text =
              String(url);

            calls.push(text);

            if (
              text.includes(
                "primary"
              ) &&
              !primaryUp
            ) {
              throw new Error(
                "primary down"
              );
            }

            return ok();
          }
      });

    await uplink.send(
      telemetry
    );

    assert.equal(
      uplink.status()
        .activeRole,
      "BACKUP_1"
    );

    calls.length = 0;

    clock = 500;

    await uplink.send(
      telemetry
    );

    assert.deepEqual(
      calls,
      [
        "http://backup.local/telemetry"
      ]
    );

    primaryUp = true;
    clock = 1500;
    calls.length = 0;

    await uplink.send(
      telemetry
    );

    assert.deepEqual(
      calls,
      [
        "http://primary.local/telemetry"
      ]
    );

    assert.equal(
      uplink.status()
        .activeRole,
      "PRIMARY"
    );

    assert.equal(
      uplink.status()
        .failbackCount,
      1
    );
  }
);

test(
  "모든 서버 장애 시 실패 처리한다",
  async () => {
    const uplink =
      createFailoverUplink({
        urls: [
          "http://primary.local/telemetry",
          "http://backup.local/telemetry"
        ],

        fetchImpl:
          async () => {
            throw new Error(
              "all down"
            );
          }
      });

    await assert.rejects(
      uplink.send(
        telemetry
      ),
      /all down/
    );
  }
);
