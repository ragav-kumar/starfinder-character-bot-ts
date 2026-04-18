type LogContext = Record<string, unknown>;

function formatContext(context: LogContext): string {
  const entries = Object.entries(context).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return "none";
  }

  return entries
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getErrorHeader(error: unknown): string {
  if (error instanceof Error) {
    return error.name && error.message ? `${error.name}: ${error.message}` : error.message;
  }

  return `Non-Error throw: ${formatValue(error)}`;
}

function getErrorDetails(error: unknown): string[] {
  const details: string[] = [];

  if (!isObjectRecord(error)) {
    return details;
  }

  const code = error.code;
  const status = error.status;
  const method = error.method;
  const url = error.url;
  const rawError = error.rawError;

  if (code !== undefined || status !== undefined) {
    details.push(
      [
        code !== undefined ? `code=${String(code)}` : null,
        status !== undefined ? `status=${String(status)}` : null,
      ]
        .filter(Boolean)
        .join(", "),
    );
  }

  if (method !== undefined || url !== undefined) {
    details.push(
      [
        method !== undefined ? `method=${String(method)}` : null,
        url !== undefined ? `url=${String(url)}` : null,
      ]
        .filter(Boolean)
        .join(", "),
    );
  }

  if (isObjectRecord(rawError)) {
    const rawCode = rawError.code;
    const rawMessage = rawError.message;
    if (rawCode !== undefined || rawMessage !== undefined) {
      details.push(
        [
          rawCode !== undefined ? `apiCode=${String(rawCode)}` : null,
          rawMessage !== undefined ? `apiMessage=${String(rawMessage)}` : null,
        ]
          .filter(Boolean)
          .join(", "),
      );
    }
  }

  return details.filter(Boolean);
}

export function logException(label: string, error: unknown, context: LogContext = {}): void {
  console.error(`[${label}] ${getErrorHeader(error)}`);
  console.error(`Context: ${formatContext(context)}`);

  for (const detail of getErrorDetails(error)) {
    console.error(`Details: ${detail}`);
  }

  if (error instanceof Error) {
    if (error.stack) {
      console.error(`Stack:\n${error.stack}`);
    }
    return;
  }

  console.error(`Thrown value: ${formatValue(error)}`);
}
