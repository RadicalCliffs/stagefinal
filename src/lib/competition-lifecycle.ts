import { supabase } from './supabase';
import { StagingRNG } from './rng-utils';

interface CompetitionEntry {
  uid: string;
  competitionid: string;
  userid: string;
  walletaddress: string | null;
  numberoftickets: number;
  ticketnumbers: string | null;
  amountspent: number;
  purchasedate: string;
}

/**
 * Detect if we're in production environment
 */
const isProduction = () => {
  return typeof window !== 'undefined' &&
    !window.location.hostname.includes('localhost') &&
    !window.location.hostname.includes('127.0.0.1');
};

/**
 * Sleep helper for retry delays
 */
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry wrapper with exponential backoff for Supabase calls
 * This helps handle transient network issues (ERR_CONNECTION_CLOSED, etc.)
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries: number = 3,
  initialDelayMs: number = 250
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Only log in non-production or on final attempt
      if (!isProduction() || attempt === maxRetries) {
        console.warn(`[Competition Lifecycle] ${operationName} failed (attempt ${attempt}/${maxRetries}): ${errorMsg}`);
      }

      if (attempt < maxRetries) {
        // Exponential backoff with jitter
        const delay = initialDelayMs * Math.pow(2, attempt - 1) + Math.random() * 100;
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Safe logging that suppresses verbose errors in production
 */
const safeLog = (message: string, ...args: any[]) => {
  if (!isProduction()) {
    console.log(message, ...args);
  }
};

const safeError = (message: string, error?: any) => {
  // Always log errors, but with less detail in production
  if (isProduction()) {
    console.error(`[Competition Lifecycle] Error: ${message}`);
  } else {
    console.error(message, error);
  }
};

/**
 * Competition Lifecycle Management Service
 *
 * NOTE: The primary lifecycle checking has been moved to a server-side scheduled function
 * (netlify/functions/competition-lifecycle-checker.mts) which runs every 5 minutes.
 *
 * This client-side service is kept for:
 * 1. Manual triggers from the admin dashboard
 * 2. Backwards compatibility with existing code
 *
 * The server-side function is preferred because it:
 * - Eliminates client-side network issues (ERR_CONNECTION_CLOSED)
 * - Uses service role key for reliable database access
 * - Runs reliably on a schedule regardless of user activity
 */
export class CompetitionLifecycleService {
  private static checkInterval: NodeJS.Timeout | null = null;
  private static isChecking = false;

  /**
   * Check for expired competitions and process them
   * This now checks ALL non-terminal statuses to catch any competitions that may have been missed
   */
  static async processExpiredCompetitions(): Promise<void> {
    // Prevent concurrent execution
    if (this.isChecking) {
      safeLog('[Competition Lifecycle] Skipping - check already in progress');
      return;
    }

    this.isChecking = true;

    try {
      safeLog('[Competition Lifecycle] Checking for expired competitions...');

      // Get all competitions that have passed their end date and are NOT in terminal states
      // This catches: active, drawing, and draft competitions that should have been processed
      const { data: expiredCompetitions, error } = await withRetry(
        () => supabase
          .from('competitions')
          .select('*')
          .in('status', ['active', 'drawing', 'draft'])
          .not('end_date', 'is', null)
          .lt('end_date', new Date().toISOString()),
        'fetch expired competitions'
      );

      if (error) {
        safeError('[Competition Lifecycle] Error fetching expired competitions', error);
        return;
      }

      if (!expiredCompetitions || expiredCompetitions.length === 0) {
        safeLog('[Competition Lifecycle] No expired competitions found');
        return;
      }

      safeLog(`[Competition Lifecycle] Found ${expiredCompetitions.length} expired competition(s)`);

      // Process each expired competition
      for (const competition of expiredCompetitions) {
        try {
          await this.drawCompetition(competition);
        } catch (error) {
          safeError(`[Competition Lifecycle] Error processing competition ${competition.id}`, error);
        }
      }
    } catch (error) {
      safeError('[Competition Lifecycle] Fatal error in processExpiredCompetitions', error);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Check for sold-out competitions and process them
   * This is a backup check in case the confirm-pending-tickets function didn't catch it
   */
  static async processSoldOutCompetitions(): Promise<void> {
    try {
      safeLog('[Competition Lifecycle] Checking for sold-out competitions...');

      // Get all active competitions with defined total_tickets
      const { data: activeCompetitions, error } = await withRetry(
        () => supabase
          .from('competitions')
          .select('*')
          .eq('status', 'active')
          .gt('total_tickets', 0),
        'fetch active competitions'
      );

      if (error) {
        safeError('[Competition Lifecycle] Error fetching active competitions', error);
        return;
      }

      if (!activeCompetitions || activeCompetitions.length === 0) {
        safeLog('[Competition Lifecycle] No active competitions to check');
        return;
      }

      let soldOutCount = 0;

      for (const competition of activeCompetitions) {
        try {
          // Count sold tickets for this competition
          // Use single eq filter to avoid uuid/text type mismatch in OR queries
          const { data: entries } = await withRetry(
            () => supabase
              .from('joincompetition')
              .select('ticketnumbers')
              .eq('competitionid', competition.id),
            `fetch entries for ${competition.id}`
          );

          let totalSoldTickets = 0;
          (entries || []).forEach((entry: any) => {
            if (entry.ticketnumbers) {
              const nums = entry.ticketnumbers.split(',').filter((n: string) => n.trim() !== '');
              totalSoldTickets += nums.length;
            }
          });

          // Check if sold out
          if (totalSoldTickets >= competition.total_tickets) {
            safeLog(`[Competition Lifecycle] Competition ${competition.id} (${competition.title}) is SOLD OUT: ${totalSoldTickets}/${competition.total_tickets}`);
            await this.drawCompetition(competition);
            soldOutCount++;
          }
        } catch (error) {
          safeError(`[Competition Lifecycle] Error checking sold-out status for ${competition.id}`, error);
        }
      }

      safeLog(`[Competition Lifecycle] Processed ${soldOutCount} sold-out competition(s)`);
    } catch (error) {
      safeError('[Competition Lifecycle] Fatal error in processSoldOutCompetitions', error);
    }
  }

  /**
   * Draw a competition and select winner(s)
   */
  private static async drawCompetition(competition: any): Promise<void> {
    safeLog(`[Competition Lifecycle] Drawing competition: ${competition.title} (${competition.id})`);

    try {
      // Check if competition is instant win
      if (competition.is_instant_win) {
        // Instant win competitions don't need additional winner selection
        // Winners are already determined when tickets are purchased
        await this.markCompetitionAsDrawn(competition);
        safeLog(`[Competition Lifecycle] Instant win competition ${competition.id} marked as drawn`);
        return;
      }

      // For standard competitions, select a winner from entries
      const entries = await this.getCompetitionEntries(competition.uid || competition.id);

      if (entries.length === 0) {
        safeLog(`[Competition Lifecycle] No entries found for competition ${competition.id}, marking as completed without winner`);
        await this.markCompetitionAsDrawn(competition);
        return;
      }

      // Get all purchased ticket numbers
      const allTicketNumbers: number[] = [];
      const ticketToEntryMap = new Map<number, CompetitionEntry>();

      for (const entry of entries) {
        if (entry.ticketnumbers) {
          const ticketNumbers = entry.ticketnumbers
            .split(',')
            .map(t => parseInt(t.trim()))
            .filter(t => !isNaN(t));

          ticketNumbers.forEach(ticketNum => {
            allTicketNumbers.push(ticketNum);
            ticketToEntryMap.set(ticketNum, entry);
          });
        }
      }

      if (allTicketNumbers.length === 0) {
        safeLog(`[Competition Lifecycle] No valid tickets found for competition ${competition.id}`);
        await this.markCompetitionAsDrawn(competition);
        return;
      }

      // Select winning ticket number from ACTUALLY PURCHASED tickets only
      // This ensures a winner is ALWAYS selected from purchased tickets
      // Uses cryptographically secure RNG for fairness
      const winningTicketNumber = StagingRNG.selectWinnerFromPurchasedTickets(allTicketNumbers);

      // Find the entry that owns the winning ticket
      const winningEntry = ticketToEntryMap.get(winningTicketNumber);

      if (!winningEntry) {
        // This should never happen since we're selecting from allTicketNumbers
        safeError(`[Competition Lifecycle] Unexpected: winning ticket ${winningTicketNumber} not found in map`);
      }

      if (winningEntry) {
        // Create winner record
        await this.createWinner(competition, winningEntry, winningTicketNumber);
        safeLog(`[Competition Lifecycle] Winner selected for competition ${competition.id}: User ${winningEntry.userid}`);
      }

      // Mark competition as drawn
      await this.markCompetitionAsDrawn(competition);
      safeLog(`[Competition Lifecycle] Competition ${competition.id} successfully drawn`);

    } catch (error) {
      safeError(`[Competition Lifecycle] Error drawing competition ${competition.id}`, error);
      throw error;
    }
  }

  /**
   * Get all entries for a competition
   */
  private static async getCompetitionEntries(competitionId: string): Promise<CompetitionEntry[]> {
    // Use single eq filter to avoid uuid/text type mismatch in OR queries
    // joincompetition.competitionid is TEXT, so we use the resolved ID directly
    const { data, error } = await withRetry(
      () => supabase
        .from('joincompetition')
        .select('*')
        .eq('competitionid', competitionId),
      `fetch entries for ${competitionId}`
    );

    if (error) {
      safeError('[Competition Lifecycle] Error fetching entries', error);
      return [];
    }

    return data || [];
  }

  /**
   * Create a winner record
   */
  private static async createWinner(
    competition: any,
    entry: CompetitionEntry,
    ticketNumber: number
  ): Promise<void> {
    try {
      // Check if winner already exists
      const { data: existingWinner } = await withRetry(
        () => supabase
          .from('winners')
          .select('*')
          .eq('competition_id', competition.id)
          .maybeSingle(),
        'check existing winner'
      );

      if (existingWinner) {
        safeLog(`[Competition Lifecycle] Winner already exists for competition ${competition.id}`);
        return;
      }

      // Get user details
      const { data: user } = await withRetry(
        () => supabase
          .from('canonical_users')
          .select('id, username, country, wallet_address')
          .eq('id', entry.userid)
          .maybeSingle(),
        'fetch user details'
      );

      // Create winner record
      const winnerData = {
        competition_id: competition.id,
        user_id: entry.userid,
        ticket_number: ticketNumber,
        prize_value: competition.prize_value || 0,
        prize_claimed: false,
        username: user?.username || 'Unknown',
        country: user?.country || null,
        wallet_address: entry.walletaddress || user?.wallet_address || null,
        crdate: new Date().toISOString()
      };

      const { error } = await withRetry(
        () => supabase.from('winners').insert(winnerData),
        'create winner record'
      );

      if (error) {
        safeError('[Competition Lifecycle] Error creating winner', error);
        throw error;
      }

      safeLog(`[Competition Lifecycle] Winner record created successfully`);
    } catch (error) {
      safeError('[Competition Lifecycle] Error in createWinner', error);
      throw error;
    }
  }

  /**
   * Mark competition as drawn/completed
   */
  private static async markCompetitionAsDrawn(competition: any): Promise<void> {
    const { error } = await withRetry(
      () => supabase
        .from('competitions')
        .update({
          status: 'completed',
          competitionended: 1,
          draw_date: new Date().toISOString()
        })
        .eq('id', competition.id),
      'mark competition as drawn'
    );

    if (error) {
      safeError('[Competition Lifecycle] Error marking competition as drawn', error);
      throw error;
    }
  }

  /**
   * Start the automated lifecycle checker
   *
   * NOTE: This is now deprecated in favor of the server-side scheduled function.
   * The client-side checker is disabled to prevent ERR_CONNECTION_CLOSED errors.
   * See: netlify/functions/competition-lifecycle-checker.mts
   */
  static startAutomatedChecker(): NodeJS.Timeout | null {
    // Client-side automated checking is disabled - use server-side scheduled function instead
    safeLog('[Competition Lifecycle] Client-side automated checker is disabled.');
    safeLog('[Competition Lifecycle] Competition lifecycle is now managed by server-side scheduled function.');

    // Return null instead of starting interval
    return null;
  }

  /**
   * Stop the automated checker (if running)
   */
  static stopAutomatedChecker(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      safeLog('[Competition Lifecycle] Automated checker stopped');
    }
  }

  /**
   * Manual trigger to process expired and sold-out competitions
   * Can be called from admin dashboard
   */
  static async manualProcessExpiredCompetitions(): Promise<{
    success: boolean;
    message: string;
    processedCount: number;
  }> {
    try {
      const { data: expiredCompetitions } = await withRetry(
        () => supabase
          .from('competitions')
          .select('*')
          .eq('status', 'active')
          .not('end_date', 'is', null)
          .lt('end_date', new Date().toISOString()),
        'fetch expired competitions for manual process'
      );

      const count = expiredCompetitions?.length || 0;

      await this.processExpiredCompetitions();
      await this.processSoldOutCompetitions();

      return {
        success: true,
        message: `Processed ${count} expired competition(s) and checked for sold-out competitions`,
        processedCount: count
      };
    } catch (error) {
      return {
        success: false,
        message: `Error processing competitions: ${error instanceof Error ? error.message : 'Unknown error'}`,
        processedCount: 0
      };
    }
  }
}
