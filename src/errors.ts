// @internal
export function check(condition: unknown, message: string | (() => string)): asserts condition {
  if (!condition) {
    throw new Error(tag(typeof message === "string" ? message : message()));
  }
}

// @internal
export function tag(message: string): string {
  return `[message-bus] ${message}`;
}
