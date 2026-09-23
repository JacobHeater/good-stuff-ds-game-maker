/** Internal helper — not exported from the package. Keeps ENOENT-detection identical across the Node-backed port implementations. */
export function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
