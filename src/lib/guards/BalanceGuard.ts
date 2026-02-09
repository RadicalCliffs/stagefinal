/**
 * BalanceGuard
 * 
 * Purpose:
 * - Keep the latest authoritative balance snapshot
 * - Provide requireAvailable and requirePending checks that gate UI/actions
 * - Offer a waitForBalancesChanged helper to await a new balance version after an operation
 */

import type { BalanceSnapshot } from './types';

type BalanceSource = {
  // Returns latest cached balance snapshot (from your realtime service/store)
  getLatest: () => BalanceSnapshot | null;
  // Optional: subscribe to balance changes, returning an unsubscribe function
  subscribe?: (handler: (b: BalanceSnapshot) => void) => () => void;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class BalanceGuard {
  private source: BalanceSource;
  private lastAcceptedVersion?: number | string;

  constructor(source: BalanceSource) {
    this.source = source;
    const latest = source.getLatest();
    this.lastAcceptedVersion = latest?.version ?? latest?.updated_at;
  }

  getLatest(): BalanceSnapshot | null {
    return this.source.getLatest();
  }

  requireAvailable(amount: number): void {
    const b = this.source.getLatest();
    if (!b) throw new Error('Balances not ready. Please wait for connection.');
    if (b.available < amount) {
      throw new Error(
        `Insufficient available balance. Need ${amount}, have ${b.available}.`
      );
    }
  }

  requirePending(amount: number): void {
    const b = this.source.getLatest();
    if (!b) throw new Error('Balances not ready. Please wait for connection.');
    if (b.pending < amount) {
      throw new Error(
        `Pending balance not locked for this operation. Need ${amount}, pending ${b.pending}.`
      );
    }
  }

  // Waits until a newer balance snapshot arrives and passes an optional predicate
  async waitForBalancesChanged(opts?: {
    timeoutMs?: number;
    predicate?: (b: BalanceSnapshot) => boolean;
  }): Promise<BalanceSnapshot> {
    const timeoutMs = opts?.timeoutMs ?? 3000;
    const start = Date.now();
    let initial = this.source.getLatest();
    const initialVer = initial?.version ?? initial?.updated_at;

    if (opts?.predicate && initial && opts.predicate(initial)) {
      return initial;
    }

    if (!this.source.subscribe) {
      // Poll as a conservative fallback if subscription not available
      while (Date.now() - start < timeoutMs) {
        await sleep(100);
        const now = this.source.getLatest();
        const nowVer = now?.version ?? now?.updated_at;
        if (
          now &&
          nowVer &&
          (!initialVer || nowVer !== initialVer) &&
          (!opts?.predicate || opts.predicate(now))
        ) {
          this.lastAcceptedVersion = nowVer;
          return now;
        }
      }
      throw new Error('Timed out waiting for balances change.');
    }

    return new Promise<BalanceSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => {
        off?.();
        reject(new Error('Timed out waiting for balances change.'));
      }, timeoutMs);

      const off = this.source.subscribe!((b) => {
        const ver = b.version ?? b.updated_at;
        if (ver && ver !== initialVer && (!opts?.predicate || opts.predicate(b))) {
          clearTimeout(timer);
          off?.();
          this.lastAcceptedVersion = ver;
          resolve(b);
        }
      });
    });
  }
}
