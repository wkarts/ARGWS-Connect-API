export type GroupIdentity = { subject: string; avatar?: string };

/** Per-instance targeted metadata lookup. No agenda/history sweep and no timer. */
export class ZapoGroupIdentityCache {
  private readonly values = new Map<string, { expiresAt: number; value?: GroupIdentity }>();
  private readonly pending = new Map<string, Promise<GroupIdentity | undefined>>();
  constructor(
    private readonly load: (jid: string) => Promise<GroupIdentity>,
    private readonly now = Date.now,
  ) {}
  invalidate(jid: string): void {
    this.values.delete(jid);
  }
  resolve(jid: string): Promise<GroupIdentity | undefined> {
    if (!/^\d+(?:-\d+)?@g\.us$/.test(jid)) return Promise.resolve(undefined);
    const cached = this.values.get(jid);
    if (cached && cached.expiresAt > this.now()) return Promise.resolve(cached.value);
    if (this.pending.has(jid)) return this.pending.get(jid)!;
    if (this.pending.size >= 4) return Promise.resolve(undefined);
    const task = this.load(jid)
      .then((value) => {
        const subject = typeof value?.subject === 'string' ? value.subject.trim().slice(0, 100) : '';
        return subject ? { subject, avatar: value.avatar } : undefined;
      })
      .catch(() => undefined)
      .then((value) => {
        this.values.set(jid, { value, expiresAt: this.now() + (value ? 300000 : 30000) });
        if (this.values.size > 256) this.values.delete(this.values.keys().next().value);
        return value;
      })
      .finally(() => this.pending.delete(jid));
    this.pending.set(jid, task);
    return task;
  }
}
