/**
 * Ticket Reservation Storage Service
 * 
 * Manages persistent storage of ticket reservations across page refreshes.
 * Uses sessionStorage for temporary persistence (cleared when browser closes).
 * 
 * This fixes the bug where users lose their reservation after refreshing the page
 * during the purchase flow.
 */

interface ReservationData {
  reservationId: string;
  competitionId: string;
  ticketNumbers: number[];
  userId: string;
  timestamp: number;
  expiresAt?: number;
}

const STORAGE_KEY = 'theprize:active_reservations';
const RESERVATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

class ReservationStorage {
  /**
   * Store a reservation in sessionStorage
   */
  storeReservation(data: Omit<ReservationData, 'timestamp'>): void {
    try {
      const reservation: ReservationData = {
        ...data,
        timestamp: Date.now(),
        expiresAt: data.expiresAt || (Date.now() + RESERVATION_TTL_MS)
      };

      const stored = this.getAllReservations();
      // Replace existing reservation for this competition or add new one
      const filtered = stored.filter(r => r.competitionId !== data.competitionId);
      filtered.push(reservation);

      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
      
      console.log('[ReservationStorage] Stored reservation:', {
        reservationId: data.reservationId,
        competitionId: data.competitionId,
        ticketCount: data.ticketNumbers.length
      });
    } catch (err) {
      console.error('[ReservationStorage] Failed to store reservation:', err);
    }
  }

  /**
   * Get all active reservations from sessionStorage
   */
  getAllReservations(): ReservationData[] {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (!stored) return [];

      const reservations: ReservationData[] = JSON.parse(stored);
      const now = Date.now();

      // Filter out expired reservations
      const active = reservations.filter(r => {
        const isExpired = r.expiresAt && r.expiresAt < now;
        return !isExpired;
      });

      // Update storage if we removed expired ones
      if (active.length !== reservations.length) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(active));
      }

      return active;
    } catch (err) {
      console.error('[ReservationStorage] Failed to get reservations:', err);
      return [];
    }
  }

  /**
   * Get reservation for a specific competition
   */
  getReservation(competitionId: string): ReservationData | null {
    const all = this.getAllReservations();
    const found = all.find(r => r.competitionId === competitionId);
    
    if (found) {
      console.log('[ReservationStorage] Retrieved reservation:', {
        reservationId: found.reservationId,
        competitionId: found.competitionId,
        ticketCount: found.ticketNumbers.length,
        age: Math.round((Date.now() - found.timestamp) / 1000) + 's'
      });
    }
    
    return found || null;
  }

  /**
   * Clear reservation for a specific competition
   */
  clearReservation(competitionId: string): void {
    try {
      const stored = this.getAllReservations();
      const filtered = stored.filter(r => r.competitionId !== competitionId);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
      
      console.log('[ReservationStorage] Cleared reservation for competition:', competitionId);
    } catch (err) {
      console.error('[ReservationStorage] Failed to clear reservation:', err);
    }
  }

  /**
   * Clear all reservations
   */
  clearAll(): void {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      console.log('[ReservationStorage] Cleared all reservations');
    } catch (err) {
      console.error('[ReservationStorage] Failed to clear all reservations:', err);
    }
  }

  /**
   * Check if a reservation exists and is still valid
   */
  hasValidReservation(competitionId: string): boolean {
    const reservation = this.getReservation(competitionId);
    if (!reservation) return false;

    const now = Date.now();
    const isExpired = reservation.expiresAt && reservation.expiresAt < now;
    
    return !isExpired;
  }
}

// Export singleton instance
export const reservationStorage = new ReservationStorage();
