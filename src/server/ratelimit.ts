// Token-bucket rate limiter keyed by token hash or IP.

interface Bucket { tokens: number; at: number }

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly burst: number;
  private readonly perSec: number;

  constructor(burst: number, perSec: number) {
    this.burst = burst;
    this.perSec = perSec;
  }

  /** Consume one token; false when the key is over its limit. */
  take(key: string, now = Date.now()): boolean {
    let b = this.buckets.get(key);
    if (!b) { b = { tokens: this.burst, at: now }; this.buckets.set(key, b); }
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.at) / 1000) * this.perSec);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Whether a take() would succeed now, without consuming anything. */
  ok(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key);
    return !b || Math.min(this.burst, b.tokens + ((now - b.at) / 1000) * this.perSec) >= 1;
  }

  /** Drop buckets that have fully refilled. */
  prune(now = Date.now()): void {
    for (const [k, b] of this.buckets) {
      if (b.tokens + ((now - b.at) / 1000) * this.perSec >= this.burst) this.buckets.delete(k);
    }
  }
}
