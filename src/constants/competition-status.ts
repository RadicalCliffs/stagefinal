/**
 * Competition Status Constants and Utilities
 *
 * These constants and utility functions are used across competition-related components.
 * Separated from components to avoid React Fast Refresh issues.
 */

/**
 * Statuses that indicate a competition has finished
 * Used for filtering entries in the dashboard
 */
export const FINISHED_COMPETITION_STATUSES = ['completed', 'drawn', 'sold_out', 'cancelled', 'expired'] as const;

/**
 * Type guard to check if a status is a finished status
 */
export function isFinishedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return FINISHED_COMPETITION_STATUSES.includes(status as any);
}

/**
 * Get human-readable status description
 */
export const getStatusDescription = (status: string): string => {
  const descriptions: Record<string, string> = {
    active: 'This competition is currently live and accepting entries.',
    drawing: 'The winner is being selected. Please wait...',
    drawn: 'The winner has been selected for this competition.',
    completed: 'This competition has ended and prizes have been awarded.',
    cancelled: 'This competition has been cancelled. Refunds may be issued.',
    expired: 'This competition has ended without a winner being drawn.',
    draft: 'This competition is not yet published.',
    paused: 'This competition is temporarily paused.',
  };

  return descriptions[status?.toLowerCase()] || 'Status unknown';
};

/**
 * Check if competition allows entries
 */
export const canEnterCompetition = (status: string): boolean => {
  const entryStatuses = ['active'];
  return entryStatuses.includes(status?.toLowerCase() || '');
};

/**
 * Check if competition is in a final state
 */
export const isFinalState = (status: string): boolean => {
  const finalStatuses = ['drawn', 'completed', 'cancelled', 'expired'];
  return finalStatuses.includes(status?.toLowerCase() || '');
};
