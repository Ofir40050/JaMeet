export function deviceError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Camera or microphone access was denied. Allow access in system settings, then try again.';
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'No usable camera or audio input was found.';
  }
  return error instanceof Error ? error.message : 'The selected device could not be opened.';
}
