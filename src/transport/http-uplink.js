import { log } from "../logging/logger.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(telemetry),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      log("TELEMETRY_SENT", {
        droneId: telemetry.droneId,
        attempt
      });

      return;
    } catch (error) {
      lastError = error;

      log(
        "SEND_FAILED",
        {
          droneId: telemetry.droneId,
          attempt,
          error: error instanceof Error ? error.message : String(error)
        },
        "WARN"
      );

      if (attempt < maxAttempts) {
        const delayMs = Math.min(1000 * 2 ** (attempt - 1), maxRetryMs);
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}
