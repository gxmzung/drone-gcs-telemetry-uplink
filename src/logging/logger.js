export function log(event, fields = {}, level = "INFO") {
  process.stdout.write(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...fields
    }) + "\n"
  );
}
