/**
 * Application Configuration
 *
 * ISSUE #5 FIX: Centralized configuration for application-wide settings
 * This prevents inconsistent settings across different files and makes
 * configuration changes easier to manage.
 */

/**
 * Competition visibility cutoff date
 * Only competitions created AFTER this date will be shown in the frontend.
 * This allows hiding legacy competitions without deleting them from the database.
 *
 * Set to null to show all competitions regardless of creation date.
 *
 * IMPORTANT: When changing this value, ensure all date comparisons use
 * the helper functions below to maintain consistency.
 */
export const COMPETITION_VISIBILITY_CUTOFF: string | null = "2026-03-08T00:00:00.000Z";

/**
 * Check if a competition should be visible based on its creation date
 * @param createdAt - The competition's creation date
 * @returns true if the competition should be shown
 */
export function isCompetitionVisible(createdAt: string | Date | null | undefined): boolean {
  // If no cutoff is configured, show all competitions
  if (!COMPETITION_VISIBILITY_CUTOFF) {
    return true;
  }

  // If no creation date, hide the competition (data integrity issue)
  if (!createdAt) {
    return false;
  }

  const createdDate = new Date(createdAt);
  const cutoffDate = new Date(COMPETITION_VISIBILITY_CUTOFF);

  // Show competition if it was created on or after the cutoff date
  return createdDate >= cutoffDate;
}

/**
 * Check if a date is after the visibility cutoff
 * This is a more general helper for any date-based visibility check
 * @param date - The date to check
 * @returns true if the date is after the cutoff
 */
export function isAfterVisibilityCutoff(date: string | Date | null | undefined): boolean {
  return isCompetitionVisible(date);
}

/**
 * Get the visibility cutoff date as a Date object
 * @returns The cutoff date or null if no cutoff is configured
 */
export function getVisibilityCutoffDate(): Date | null {
  if (!COMPETITION_VISIBILITY_CUTOFF) {
    return null;
  }
  return new Date(COMPETITION_VISIBILITY_CUTOFF);
}

/**
 * Dashboard polling intervals (in milliseconds)
 */
export const DASHBOARD_CONFIG = {
  /** How often to refresh competition data */
  COMPETITION_REFRESH_INTERVAL_MS: 120000, // 2 minutes

  /** How often to poll for payment status updates */
  PAYMENT_POLL_INTERVAL_MS: 5000, // 5 seconds

  /** How often to check for new entries/tickets */
  ENTRIES_REFRESH_INTERVAL_MS: 30000, // 30 seconds
} as const;

/**
 * Pagination defaults
 */
export const PAGINATION_CONFIG = {
  /** Default page size for entries list */
  ENTRIES_PER_PAGE: 10,

  /** Default page size for transactions list */
  TRANSACTIONS_PER_PAGE: 20,

  /** Default page size for competitions list */
  COMPETITIONS_PER_PAGE: 100,
} as const;

/**
 * Ticket reservation settings
 */
export const TICKET_CONFIG = {
  /** How long a ticket reservation lasts before expiring (in minutes) */
  RESERVATION_TIMEOUT_MINUTES: 10,

  /** Maximum tickets a user can reserve at once */
  MAX_TICKETS_PER_RESERVATION: 100,
} as const;

export default {
  COMPETITION_VISIBILITY_CUTOFF,
  isCompetitionVisible,
  isAfterVisibilityCutoff,
  getVisibilityCutoffDate,
  DASHBOARD_CONFIG,
  PAGINATION_CONFIG,
  TICKET_CONFIG,
};
