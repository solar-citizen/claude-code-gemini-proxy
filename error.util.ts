export function isErrorWithMessage(err: unknown): err is { message: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof err.message === 'string'
  );
}

export function getErrorMessage(err: unknown): string {
  if (isErrorWithMessage(err)) {
    return err.message;
  }

  return String(err);
}
