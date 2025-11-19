// @internal
export function isDisposed(value: any): boolean {
  if (!value || value.isDisposed === undefined) {
    return false;
  }

  if (typeof value.isDisposed === "function") {
    return value.isDisposed();
  }

  // noinspection SuspiciousTypeOfGuard
  if (typeof value.isDisposed === "boolean") {
    return value.isDisposed;
  }

  return false;
}
