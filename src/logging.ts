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

export function logException(label: string, error: unknown, context: LogContext = {}): void {
  console.error(`[${label}] Exception details`);
  console.error(`Context: ${formatContext(context)}`);
  console.error("Thrown value:", error);

  if (error instanceof Error) {
    console.error(`Message: ${error.message}`);
    if (error.stack) {
      console.error(`Stack:\n${error.stack}`);
    }
    return;
  }

  console.error(`Message: ${String(error)}`);
}
