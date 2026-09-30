export function normalizeTelemetry(value) {
  if (!value || typeof value !== "object") {
    throw new Error("telemetry payload must be an object");
  }

  const droneId = String(value.droneId ?? "").trim();
  const timestamp = String(value.timestamp ?? "").trim();
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  const altitude = Number(value.altitude);

  if (!droneId) throw new Error("droneId is required");
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw new Error("timestamp must be ISO-8601");
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error("latitude is invalid");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("longitude is invalid");
  }
  if (!Number.isFinite(altitude)) {
    throw new Error("altitude is invalid");
  }

  return {
    droneId,
    timestamp,
    latitude,
    longitude,
    altitude
  };
}

export function parseUdpTelemetry(buffer) {
  let value;

  try {
    value = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error("unsupported UDP payload: JSON adapter expected");
  }

  return normalizeTelemetry(value);
}
