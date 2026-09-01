import { MetaCloudGraphError } from './meta-cloud.error';

export class MetaCloudRateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly maxRequests = 120,
    private readonly windowMs = 60_000,
  ) {}

  public assertAllowed(key: string): void {
    const now = Date.now();
    const current = this.windows.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.windows.set(key, { startedAt: now, count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > this.maxRequests) {
      throw new MetaCloudGraphError(429, 'Too many requests.');
    }
  }
}
