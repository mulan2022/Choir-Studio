import { createHash } from 'node:crypto';

// Increment when the recognition pipeline changes the output for the same file.
export const recognitionVersion = 'raster-retry-v2';

export function recognitionKey(extension, body) {
  return createHash('sha256').update(recognitionVersion).update('\0').update(extension).update('\0').update(body).digest('hex');
}
