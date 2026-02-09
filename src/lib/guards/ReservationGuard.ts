/**
 * ReservationGuard
 * 
 * Purpose:
 * - Create a deterministic pipeline: reserve → wait for reservation_created → verify DB row → wait for balances reflect pending
 * - Provide finalize gating that re-verifies pending state and expiration before calling finalize
 * - Built-in timeouts and retry-safe behavior
 */

import { BalanceGuard } from './BalanceGuard';
import type { ReservationRow, PurchaseEvent } from './types';

type PurchaseEventSource = {
  // Subscribe to purchase-related events (reservation_created, purchase_confirmed, etc.)
  subscribe: (handler: (e: PurchaseEvent) => void) => () => void;
};

type Repo = {
  // Server-side reads for verification
  fetchReservation: (reservationId: string) => Promise<ReservationRow | null>;
  // Optional helpers for tickets existence checks after confirmation
  // fetchTicketsForReservation?: (reservationId: string) => Promise<any[]>
};

type Clock = { now: () => number };

export class ReservationGuard {
  private balances: BalanceGuard;
  private events: PurchaseEventSource;
  private repo: Repo;
  private clock: Clock;

  constructor(params: {
    balances: BalanceGuard;
    events: PurchaseEventSource;
    repo: Repo;
    clock?: Clock;
  }) {
    this.balances = params.balances;
    this.events = params.events;
    this.repo = params.repo;
    this.clock = params.clock ?? { now: () => Date.now() };
  }

  // Step 1: Before reserve, ensure sufficient available
  assertAvailableFor(amount: number) {
    this.balances.requireAvailable(amount);
  }

  // Step 2: After you call your reservation function (server-side), await the echo and verify DB
  async awaitReservationCreated(
    reservationId: string,
    totalAmount: number,
    opts?: {
      timeoutMs?: number;
      verifyDb?: boolean;
      requirePendingBalance?: boolean;
    }
  ) {
    const timeoutMs = opts?.timeoutMs ?? 4000;

    // 2.1 Wait for reservation_created for this id
    await this.waitForEvent('reservation_created', reservationId, timeoutMs);

    // 2.2 Verify DB row exists and is pending
    if (opts?.verifyDb !== false) {
      const row = await this.repo.fetchReservation(reservationId);
      if (!row) throw new Error('Reservation not found after creation.');
      if (row.status !== 'pending')
        throw new Error(`Reservation status mismatch: ${row.status}`);
      if (this.isExpired(row.expires_at))
        throw new Error('Reservation already expired.');
      if (Math.round(row.total_amount) !== Math.round(totalAmount)) {
        throw new Error(
          `Reservation total mismatch. Expected ${totalAmount}, got ${row.total_amount}.`
        );
      }
    }

    // 2.3 Wait for balances to reflect pending
    if (opts?.requirePendingBalance !== false) {
      await this.balances.waitForBalancesChanged({
        timeoutMs: 3000,
        predicate: (b) => b.pending >= totalAmount,
      });
    }
  }

  // Step 3: Before finalize, re-verify pending state
  async assertPendingFor(reservationId: string, totalAmount: number) {
    this.balances.requirePending(totalAmount);

    const row = await this.repo.fetchReservation(reservationId);
    if (!row) throw new Error('Reservation not found.');
    if (row.status !== 'pending')
      throw new Error(`Reservation status is ${row.status}, expected pending.`);
    if (this.isExpired(row.expires_at))
      throw new Error('Reservation expired.');
  }

  // Helper: Wait for a specific event type with reservation_id match
  private async waitForEvent(
    eventType: PurchaseEvent['type'],
    reservationId: string,
    timeoutMs: number
  ): Promise<PurchaseEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`Timed out waiting for ${eventType}`));
      }, timeoutMs);

      const off = this.events.subscribe((e) => {
        if (e.type === eventType && e.reservation_id === reservationId) {
          clearTimeout(timer);
          off();
          resolve(e);
        }
      });
    });
  }

  // Helper: Check if reservation is expired
  private isExpired(expiresAt: string): boolean {
    return new Date(expiresAt).getTime() < this.clock.now();
  }
}
