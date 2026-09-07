import { createHash } from 'node:crypto';

export function stableSerialize(item: unknown): string {
  if (item === null || typeof item !== 'object') return JSON.stringify(item);
  if (Array.isArray(item)) return `[${item.map(stableSerialize).join(',')}]`;
  return `{${Object.entries(item as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
    .join(',')}}`;
}

export function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableSerialize(value)).digest('hex')}`;
}
