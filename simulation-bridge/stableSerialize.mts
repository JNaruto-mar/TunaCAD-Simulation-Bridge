/** Shared canonical bytes. No filesystem, process, owner or cryptographic API. */
export function stableSerialize(item: unknown): string {
  if (item === null || typeof item !== 'object') return JSON.stringify(item);
  if (Array.isArray(item)) return `[${item.map(stableSerialize).join(',')}]`;
  return `{${Object.entries(item as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
    .join(',')}}`;
}
