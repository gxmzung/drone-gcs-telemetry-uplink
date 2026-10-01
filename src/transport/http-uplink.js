import {
  log
} from "../logging/logger.js";

const sleep =
  (ms) =>
    new Promise(
      (resolve) =>
        setTimeout(resolve, ms)
    );

function positiveInteger(
  value,
  fallback
) {
  const parsed =
    Number.parseInt(
      String(value ?? ""),
      10
    );

  return (
    Number.isInteger(parsed) &&
    parsed > 0
  )
    ? parsed
    : fallback;
}

function normalizeUrl(
  value
) {
  const text =
    String(value ?? "")
      .trim();

  if (!text) {
    throw new Error(
      "Telemetry server URL is required"
    );
  }

  const parsed =
    new URL(text);

  if (
    parsed.protocol !== "http:" &&
    parsed.protocol !== "https:"
  ) {
    throw new Error(
      "Telemetry server URL must use HTTP or HTTPS"
    );
  }

  return parsed
    .toString()
    .replace(/\/$/, "");
}

export function parseTelemetryServerUrls(
  multipleValue,
  singleValue,
  fallback =
    "http://127.0.0.1:18020/internal/v1/telemetry/drone"
) {
  const multiple =
    String(
      multipleValue ?? ""
    ).trim();

  const rows =
    multiple
      ? multiple.split(/[;,]/)
      : [
          singleValue ||
          fallback
        ];

  const result = [];

  for (
    const row of rows
  ) {
    const text =
      String(row ?? "")
        .trim();

    if (!text) {
      continue;
    }

    const url =
      normalizeUrl(text);

    if (
      !result.includes(url)
    ) {
      result.push(url);
    }
  }

  if (!result.length) {
    throw new Error(
      "At least one telemetry server URL is required"
    );
  }

  return result;
}

export async function sendTelemetry(
  telemetry,
  {
    url,
    timeoutMs = 5000,
    maxAttempts = 4,
    maxRetryMs = 30000,
    fetchImpl = fetch
  }
) {
  let lastError;

  const attempts =
    positiveInteger(
      maxAttempts,
      1
    );

  for (
    let attempt = 1;
    attempt <= attempts;
    attempt += 1
  ) {
    try {
      const response =
        await fetchImpl(
          url,
          {
            method:
              "POST",

            headers: {
              "content-type":
                "application/json"
            },

            body:
              JSON.stringify(
                telemetry
              ),

            signal:
              AbortSignal.timeout(
                positiveInteger(
                  timeoutMs,
                  5000
                )
              )
          }
        );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}`
        );
      }

      log(
        "TELEMETRY_SENT",
        {
          droneId:
            telemetry.droneId,

          attempt,

          targetUrl:
            url
        }
      );

      return {
        url,
        attempt,
        status:
          response.status
      };
    } catch (error) {
      lastError =
        error;

      log(
        "SEND_FAILED",
        {
          droneId:
            telemetry.droneId,

          attempt,

          targetUrl:
            url,

          error:
            error instanceof Error
              ? error.message
              : String(error)
        },
        "WARN"
      );

      if (
        attempt <
        attempts
      ) {
        const delayMs =
          Math.min(
            1000 *
              2 **
              (attempt - 1),

            positiveInteger(
              maxRetryMs,
              30000
            )
          );

        await sleep(
          delayMs
        );
      }
    }
  }

  throw lastError;
}

export function createFailoverUplink({
  urls,
  timeoutMs = 1500,
  attemptsPerServer = 1,
  failbackProbeEveryMs = 10000,
  fetchImpl = fetch,
  now = () => Date.now()
}) {
  if (
    !Array.isArray(urls) ||
    urls.length === 0
  ) {
    throw new Error(
      "Failover uplink requires at least one server URL"
    );
  }

  const serverUrls =
    urls.map(
      normalizeUrl
    );

  let activeIndex = 0;

  let failoverCount = 0;
  let failbackCount = 0;

  let lastSwitchAt = null;
  let lastSwitchDurationMs = null;
  let totalSwitchDowntimeMs = 0;

  let lastFailureAt = null;
  let lastRecoveryAt = null;

  let lastPrimaryProbeAt =
    now();

  function roleOf(
    index
  ) {
    return index === 0
      ? "PRIMARY"
      : `BACKUP_${index}`;
  }

  function status() {
    return {
      activeIndex,

      activeRole:
        roleOf(
          activeIndex
        ),

      activeUrl:
        serverUrls[
          activeIndex
        ],

      primaryUrl:
        serverUrls[0],

      backupUrls:
        serverUrls.slice(1),

      failoverEnabled:
        serverUrls.length > 1,

      failoverCount,
      failbackCount,

      lastSwitchAt,
      lastSwitchDurationMs,
      totalSwitchDowntimeMs,

      lastFailureAt,
      lastRecoveryAt
    };
  }

  async function sendTo(
    index,
    telemetry
  ) {
    return sendTelemetry(
      telemetry,
      {
        url:
          serverUrls[
            index
          ],

        timeoutMs,

        maxAttempts:
          attemptsPerServer,

        fetchImpl
      }
    );
  }

  function switchTarget(
    fromIndex,
    toIndex,
    startedAt
  ) {
    const switchedAt =
      now();

    const durationMs =
      Math.max(
        0,
        switchedAt -
          startedAt
      );

    activeIndex =
      toIndex;

    lastSwitchAt =
      new Date(
        switchedAt
      ).toISOString();

    lastSwitchDurationMs =
      durationMs;

    totalSwitchDowntimeMs +=
      durationMs;

    lastRecoveryAt =
      lastSwitchAt;

    if (toIndex === 0) {
      failbackCount += 1;

      log(
        "UPLINK_FAILBACK",
        {
          from:
            roleOf(
              fromIndex
            ),

          to:
            "PRIMARY",

          targetUrl:
            serverUrls[0],

          switchDurationMs:
            durationMs,

          failbackCount
        }
      );
    } else {
      failoverCount += 1;

      lastPrimaryProbeAt =
        switchedAt;

      log(
        "UPLINK_FAILOVER",
        {
          from:
            roleOf(
              fromIndex
            ),

          to:
            roleOf(
              toIndex
            ),

          targetUrl:
            serverUrls[
              toIndex
            ],

          switchDurationMs:
            durationMs,

          failoverCount
        },
        "WARN"
      );
    }
  }

  async function send(
    telemetry
  ) {
    /*
     * Backup 사용 중 Primary 복구 확인.
     * 주기가 지난 첫 패킷을 Primary에 보내 보고,
     * 성공하면 해당 패킷부터 Primary로 복귀한다.
     */
    if (
      activeIndex !== 0 &&
      now() -
        lastPrimaryProbeAt >=
        failbackProbeEveryMs
    ) {
      const probeStartedAt =
        now();

      lastPrimaryProbeAt =
        probeStartedAt;

      try {
        const result =
          await sendTo(
            0,
            telemetry
          );

        const previousIndex =
          activeIndex;

        switchTarget(
          previousIndex,
          0,
          probeStartedAt
        );

        return {
          ...result,
          failover:
            status()
        };
      } catch (error) {
        log(
          "UPLINK_FAILBACK_PROBE_FAILED",
          {
            primaryUrl:
              serverUrls[0],

            error:
              error instanceof Error
                ? error.message
                : String(error)
          },
          "WARN"
        );
      }
    }

    const currentIndex =
      activeIndex;

    try {
      const result =
        await sendTo(
          currentIndex,
          telemetry
        );

      return {
        ...result,
        failover:
          status()
      };
    } catch (error) {
      const failureStartedAt =
        now();

      lastFailureAt =
        new Date(
          failureStartedAt
        ).toISOString();

      log(
        "UPLINK_ACTIVE_TARGET_FAILED",
        {
          activeRole:
            roleOf(
              currentIndex
            ),

          targetUrl:
            serverUrls[
              currentIndex
            ],

          error:
            error instanceof Error
              ? error.message
              : String(error)
        },
        "WARN"
      );

      let lastError =
        error;

      for (
        let offset = 1;
        offset <
        serverUrls.length;
        offset += 1
      ) {
        const candidateIndex =
          (
            currentIndex +
            offset
          ) %
          serverUrls.length;

        try {
          const result =
            await sendTo(
              candidateIndex,
              telemetry
            );

          switchTarget(
            currentIndex,
            candidateIndex,
            failureStartedAt
          );

          return {
            ...result,
            failover:
              status()
          };
        } catch (candidateError) {
          lastError =
            candidateError;

          log(
            "UPLINK_BACKUP_TARGET_FAILED",
            {
              targetRole:
                roleOf(
                  candidateIndex
                ),

              targetUrl:
                serverUrls[
                  candidateIndex
                ],

              error:
                candidateError instanceof Error
                  ? candidateError.message
                  : String(
                      candidateError
                    )
            },
            "WARN"
          );
        }
      }

      log(
        "UPLINK_ALL_TARGETS_FAILED",
        {
          droneId:
            telemetry.droneId,

          serverCount:
            serverUrls.length
        },
        "ERROR"
      );

      throw lastError;
    }
  }

  return {
    send,
    status,
    urls:
      [...serverUrls]
  };
}
