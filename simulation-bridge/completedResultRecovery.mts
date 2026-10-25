/** Host-only orchestration. Selectors never supply authentication or adapters.
 * No storage, provider, execution or approval capability is owned by this class. */
export class CompletedResultRecovery<S, R> {
  #lease: { id: string; expiresAt: number; context: string; selector: S; identity: string } | null = null;
  #generation = 0;
  #reads = 0;
  #busy = false;
  #opens = 0;
  constructor(private readonly ports: {
    parseSelector(value: unknown): S;
    assertOwner(): Promise<void>;
    context(): Promise<string>;
    read(selector: S): Promise<R>;
    identity(result: R): string;
    randomId(): string;
    now?: () => number;
  }) {}
  revoke() { this.#generation++; this.#lease = null; this.#reads = 0; }
  private now() { return (this.ports.now ?? Date.now)(); }
  private async guarded<T>(action: (context: string) => Promise<T>) {
    if (this.#busy) throw Error('RECOVERY_BUSY');
    this.#busy = true;
    const generation = this.#generation;
    try {
      await this.ports.assertOwner();
      const context = await this.ports.context();
      if (!context || generation !== this.#generation) throw Error('RECOVERY_CONTEXT_REQUIRED');
      const value = await action(context);
      const after = await this.ports.context();
      await this.ports.assertOwner();
      if (generation !== this.#generation || context !== after)
        throw Error('RECOVERY_CONTEXT_CHANGED');
      if (this.#lease && this.now() >= this.#lease.expiresAt) throw Error('RECOVERY_LEASE_UNAVAILABLE');
      return value;
    } catch (error) { this.revoke(); throw error; }
    finally { this.#busy = false; }
  }
  async open(raw: unknown) {
    if (this.#busy) throw Error('RECOVERY_BUSY');
    this.revoke();
    return this.guarded(async context => {
      if (++this.#opens > 8) throw Error('RECOVERY_OPEN_LIMIT');
      const selector = this.ports.parseSelector(raw);
      const result = await this.ports.read(structuredClone(selector));
      const id = this.ports.randomId();
      if (!/^[a-f0-9]{64}$/.test(id)) throw Error('RECOVERY_ID_INVALID');
      this.#lease = { id, expiresAt: this.now() + 120000, context, selector, identity: this.ports.identity(result) };
      return { leaseId: id, expiresAt: this.#lease.expiresAt, engineeringUsePermitted: false as const };
    });
  }
  async result(id: string) {
    return this.guarded(async context => {
      const lease = this.#lease;
      if (!lease || id !== lease.id || context !== lease.context || this.now() >= lease.expiresAt || ++this.#reads > 8)
        throw Error('RECOVERY_LEASE_UNAVAILABLE');
      // Reopen through the existing verified owner reader; never trust a cache
      // as evidence that the protected completion/runtime is still valid.
      const result = await this.ports.read(structuredClone(lease.selector));
      if (this.now() >= lease.expiresAt || this.ports.identity(result) !== lease.identity)
        throw Error('RECOVERY_RESULT_CHANGED');
      return structuredClone(result);
    });
  }
  async close(id: string) {
    await this.guarded(async () => {
      if (!this.#lease || this.#lease.id !== id) throw Error('RECOVERY_LEASE_UNAVAILABLE');
      return null;
    });
    this.revoke(); return null;
  }
}
