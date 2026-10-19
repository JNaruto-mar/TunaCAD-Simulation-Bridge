import { createHash } from 'node:crypto';
import { stableSerialize } from './stableSerialize.mts';
export { stableSerialize } from './stableSerialize.mts';

export function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableSerialize(value)).digest('hex')}`;
}
