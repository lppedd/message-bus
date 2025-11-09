// @internal
export function check(condition: unknown, message: string | (() => string)): asserts condition {
  if (!condition) {
    throw new Error(tag(typeof message === "string" ? message : message()));
  }
}

// @internal
export function error(message: string, cause?: unknown): never {
  let msg = tag(message);

  if (cause) {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const causeMsg = isError(cause) ? cause.message : String(cause);
    msg += `\n  [cause] ${untag(causeMsg)}`;
  }

  throw new Error(msg);
}

// @internal
export function tag(message: string): string {
  return `[message-bus] ${message}`;
}

function untag(message: string): string {
  return message.startsWith("[message-bus]") //
    ? message.substring(11).trimStart()
    : message;
}

function isError(value: any): value is Error {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return value && value.stack && value.message && typeof value.message === "string";
}
