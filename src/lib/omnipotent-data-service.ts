/**
 * Omnipotent Data Service
 * 
 * A centralized, comprehensive data management service that ensures:
 * 1. Data is fetched correctly from all sources
 * 2. Data is transformed consistently for display
 * 3. Data is cached appropriately to reduce redundant queries
 * 4. Errors are handled gracefully with fallbacks
 * 5. Real-time updates are managed properly
 * 6. User identity resolution works across all contexts
 * 7. AGGRESSIVE MODE: Auto-fixes schema issues on the fly
 * 
 * This service acts as a single source of truth for all data operations.
 * 
 * AGGRESSIVE MODE (when admin access available):
 * - Automatically creates missing tables
 * - Adds missing columns as needed
 * - Removes blocking constraints/triggers
 * - Retries failed operations after fixes
 */

import { supabase } from './supabase';
import { resolveUserIdentity, type ResolvedIdentity } from './identity';
import { databaseLogger } from './debug-console';
import { getDashboardEntries, getCompetitionEntries, getUnavailableTickets } from './supabase-rpc-helpers';
import { aggressiveCRUD } from './aggressive-crud';
import { hasAdminAccess, getAdminClient } from './supabase-admin';
import { schemaValidator } from './schema-validator';

// Get Supabase URL from environment for image URL normalization
// This is required for fixing malformed image URLs in the database
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
if (!SUPABASE_URL) {
  throw new Error(
    'VITE_SUPABASE_URL environment variable is required for image URL normalization. ' +
    'Please add it to your .env file (e.g., VITE_SUPABASE_URL=https://your-project.supabase.co)'
  );
}

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface OmnipotentCompetition {
  id: string;
  uid?: string;
  title: string;
  description: string;
  image_url: string;
  status: 'active' | 'completed' | 'drawing' | 'drawn' | 'cancelled' | 'expired' | 'draft';
  total_tickets: number;
  tickets_sold: number;
  ticket_price: number;
  prize_value: string;
  end_date: string;
  draw_date?: string;
  is_instant_win: boolean;
  is_featured: boolean;
  category?: string;
  created_at: string;
  updated_at: string;
}

export interface OmnipotentEntry {
  id: string;
  competition_id: string;
  competition_title: string;
  competition_image: string;
  competition_status: string;
  ticket_numbers: number[];
  ticket_count: number;
  amount_spent: number;
  wallet_address: string;
  username?: string;
  purchase_date: string;
  transaction_hash?: string;
  is_winner: boolean;
  prize_value?: string;
  entry_type: 'confirmed' | 'pending' | 'instant_win';
}

export interface OmnipotentTicketData {
  ticket_number: number;
  competition_id: string;
  owner_wallet: string;
  owner_username?: string;
  purchase_date: string;
  transaction_hash?: string;
  is_available: boolean;
  is_pending: boolean;
  is_winner: boolean;
}

export interface DataFetchOptions {
  useCache?: boolean;
  cacheDuration?: number; // milliseconds
  includeDeleted?: boolean;
  bypassRLS?: boolean;
}

// ============================================================================
// Cache Management
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class DataCache {
  private cache: Map<string, CacheEntry<any>> = new Map();

  set<T>(key: string, data: T, ttl: number = 60000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const isExpired = Date.now() - entry.timestamp > entry.ttl;
    if (isExpired) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }

    const keysToDelete: string[] = [];
    this.cache.forEach((_, key) => {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach(key => this.cache.delete(key));
  }

  clear(): void {
    this.cache.clear();
  }
}

const dataCache = new DataCache();

// ============================================================================
// Omnipotent Data Service - Main Class
// ============================================================================

class OmnipotentDataService {
  private userIdentity: ResolvedIdentity | null = null;
  public aggressiveMode: boolean = true; // Enable by default

  /**
   * Initialize the service with user identity
   */
  async initialize(userIdentifier?: string): Promise<void> {
    if (userIdentifier) {
      try {
        this.userIdentity = await resolveUserIdentity(userIdentifier);
        databaseLogger.info('[OmnipotentData] User identity resolved', {
          hasIdentity: !!this.userIdentity,
          wallets: this.userIdentity?.walletAddress ? 1 : 0
        });
      } catch (error) {
        databaseLogger.error('[OmnipotentData] Failed to resolve user identity', error);
      }
    }

    // AGGRESSIVE MODE DISABLED - was causing 404 errors with exec_sql
    // Schema validation has been disabled to prevent unnecessary database calls
    // that fail when exec_sql RPC endpoint is not available
    if (hasAdminAccess()) {
      databaseLogger.info('[OmnipotentData] Admin access available (schema validation disabled)');
    } else {
      databaseLogger.info('[OmnipotentData] Standard mode - no admin access');
    }
  }

  /**
   * Get user identity (resolve if needed)
   */
  private async ensureUserIdentity(userIdentifier?: string): Promise<ResolvedIdentity | null> {
    if (!this.userIdentity && userIdentifier) {
      await this.initialize(userIdentifier);
    }
    return this.userIdentity;
  }

  // ==========================================================================
  // COMPETITIONS - Fetch and transform competition data
  // ==========================================================================

  /**
   * Get all competitions with optional filtering
   */
  async getCompetitions(
    status?: 'active' | 'completed' | 'drawing' | 'drawn' | 'cancelled' | 'expired' | 'draft',
    options: DataFetchOptions = {}
  ): Promise<OmnipotentCompetition[]> {
    // SCHEMA VALIDATION DISABLED - was causing 404 errors with exec_sql
    // The competition schema is assumed to exist; queries will handle validation

    const cacheKey = `competitions:${status || 'all'}`;
    
    if (options.useCache !== false) {
      const cached = dataCache.get<OmnipotentCompetition[]>(cacheKey);
      if (cached) {
        databaseLogger.debug('[OmnipotentData] Returning cached competitions');
        return cached;
      }
    }

    try {
      let query = supabase
        .from('competitions')
        .select('*')
        .eq('deleted', false)
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      const result = await query as { data: any; error: any };
      
      const { data, error } = result;

      if (error) throw error;

      const competitions = await Promise.all(
        (data || []).map(comp => this.transformCompetition(comp))
      );

      dataCache.set(cacheKey, competitions, options.cacheDuration || 30000);
      return competitions;

    } catch (error) {
      databaseLogger.error('[OmnipotentData] Failed to fetch competitions', error);
      return [];
    }
  }

  /**
   * Get a single competition by ID
   */
  async getCompetition(competitionId: string, options: DataFetchOptions = {}): Promise<OmnipotentCompetition | null> {
    const cacheKey = `competition:${competitionId}`;
    
    if (options.useCache !== false) {
      const cached = dataCache.get<OmnipotentCompetition>(cacheKey);
      if (cached) return cached;
    }

    try {
      const result = await supabase
        .from('competitions')
        .select('*')
        .eq('id', competitionId)
        .single() as { data: any; error: any };
      
      const { data, error } = result;

      if (error) throw error;

      const competition = await this.transformCompetition(data);
      dataCache.set(cacheKey, competition, options.cacheDuration || 60000);
      return competition;

    } catch (error) {
      databaseLogger.error('[OmnipotentData] Failed to fetch competition', { competitionId, error });
      return null;
    }
  }

  /**
   * Transform raw competition data to OmnipotentCompetition format
   */
  private async transformCompetition(raw: any): Promise<OmnipotentCompetition> {
    // Get tickets sold count
    let ticketsSold = raw.tickets_sold || 0;
    if (!Number.isFinite(ticketsSold)) {
      const unavailable = await this.getUnavailableTickets(raw.id);
      ticketsSold = unavailable.length;
    }

    return {
      id: raw.id,
      uid: raw.uid,
      title: raw.title || raw.competitionname || 'Untitled Competition',
      description: raw.description || raw.competitioninformation || '',
      image_url: this.normalizeImageUrl(raw.image_url || raw.imageurl),
      status: raw.status || 'active',
      total_tickets: raw.total_tickets || raw.competitionticketsize || 1000,
      tickets_sold: ticketsSold,
      ticket_price: raw.ticket_price || 1,
      prize_value: raw.prize_value || raw.competitionprize || 'Prize TBD',
      end_date: raw.end_date || raw.competitionenddate,
      draw_date: raw.draw_date,
      is_instant_win: raw.is_instant_win || raw.instant || false,
      is_featured: raw.is_featured || raw.featured === 1 || false,
      category: raw.category,
      created_at: raw.created_at || raw.crdate,
      updated_at: raw.updated_at || raw.crdate
    };
  }

  // ==========================================================================
  // ENTRIES - Fetch and transform user entry data
  // ==========================================================================

  /**
   * Get all entries for a user across all competitions
   */
  async getUserEntries(userIdentifier: string, options: DataFetchOptions = {}): Promise<OmnipotentEntry[]> {
    // SCHEMA VALIDATION DISABLED - was causing 404 errors with exec_sql
    // The entries schema is assumed to exist; queries will handle validation

    const identity = await this.ensureUserIdentity(userIdentifier);
    if (!identity) {
      databaseLogger.warn('[OmnipotentData] Cannot fetch entries without user identity');
      return [];
    }

    const cacheKey = `entries:${identity.canonicalUserId}`;
    
    if (options.useCache !== false) {
      const cached = dataCache.get<OmnipotentEntry[]>(cacheKey);
      if (cached) return cached;
    }

    try {
      // Use the comprehensive RPC function
      const { data, error } = await getDashboardEntries(supabase, identity.canonicalUserId);

      if (error) throw error;

      // Filter out entries with missing required data before transformation
      const validEntries = (Array.isArray(data) ? data : []).filter((entry: any) => {
        // Skip entries with no competition_id - these are phantom entries
        if (!entry.competition_id || entry.competition_id === '' || entry.competition_id === 'null') {
          databaseLogger.warn('[OmnipotentData] Filtering out entry with missing competition_id', { entryId: entry.id });
          return false;
        }
        return true;
      });

      const entries = validEntries.map((entry: any) => this.transformEntry(entry, identity));

      dataCache.set(cacheKey, entries, options.cacheDuration || 30000);
      return entries;

    } catch (error) {
      databaseLogger.error('[OmnipotentData] Failed to fetch user entries', error);
      return [];
    }
  }

  /**
   * Get entries for a specific competition
   */
  async getCompetitionEntries(competitionId: string, options: DataFetchOptions = {}): Promise<OmnipotentEntry[]> {
    const cacheKey = `competition_entries:${competitionId}`;

    if (options.useCache !== false) {
      const cached = dataCache.get<OmnipotentEntry[]>(cacheKey);
      if (cached) return cached;
    }

    try {
      // Try standard RPC first (staging compatible with anon key)
      let data: any[] | null = null;
      let error: any = null;

      const { data: standardData, error: standardError } = await getCompetitionEntries(supabase, competitionId);

      if (!standardError && standardData) {
        data = standardData;
      } else {
        // Fallback to bypass_rls version if standard fails
        console.log('[OmnipotentData] Standard RPC unavailable, trying bypass_rls');
        const bypassResult = await supabase
          .rpc('get_competition_entries_bypass_rls', {
            competition_identifier: competitionId
          }) as { data: any; error: any };
        
        const { data: bypassData, error: bypassError } = bypassResult;
        data = bypassData;
        error = bypassError;
      }

      if (error) throw error;

      const entries = (data || []).map(entry => this.transformCompetitionEntry(entry));

      dataCache.set(cacheKey, entries, options.cacheDuration || 15000);
      return entries;

    } catch (error) {
      databaseLogger.error('[OmnipotentData] Failed to fetch competition entries', { competitionId, error });
      return [];
    }
  }

  /**
   * Transform raw entry data to OmnipotentEntry format
   */
  private transformEntry(raw: any, identity: ResolvedIdentity): OmnipotentEntry {
    const ticketNumbers = this.parseTicketNumbers(raw.ticket_numbers);
    
    return {
      id: raw.id || `entry-${Date.now()}`,
      competition_id: raw.competition_id,
      competition_title: raw.title || 'Unknown Competition',
      competition_image: this.normalizeImageUrl(raw.image),
      competition_status: raw.competition_status || raw.status || 'active',
      ticket_numbers: ticketNumbers,
      ticket_count: raw.number_of_tickets || ticketNumbers.length,
      amount_spent: Number(raw.amount_spent) || 0,
      wallet_address: raw.wallet_address || identity.walletAddress || '',
      username: this.formatUsername(raw.wallet_address),
      purchase_date: raw.purchase_date || raw.created_at,
      transaction_hash: raw.transaction_hash,
      is_winner: raw.is_winner || false,
      prize_value: raw.prize_value,
      entry_type: raw.entry_type || 'confirmed'
    };
  }

  /**
   * Transform competition entry for public display
   */
  private transformCompetitionEntry(raw: any): OmnipotentEntry {
    const ticketNumbers = this.parseTicketNumbers(raw.ticketnumbers);
    const walletAddress = raw.wallet_address || raw.privy_user_id || '';
    
    // Filter out mock/zero addresses
    // Match Ethereum zero address: 0x followed by exactly 40 zeros
    const isValidWallet = walletAddress && 
                         !/^0x0{40}$/i.test(walletAddress);

    return {
      id: raw.uid || `entry-${Date.now()}`,
      competition_id: raw.competitionid,
      competition_title: '',
      competition_image: '',
      competition_status: 'active',
      ticket_numbers: ticketNumbers,
      ticket_count: raw.numberoftickets || ticketNumbers.length,
      amount_spent: Number(raw.amountspent) || 0,
      wallet_address: isValidWallet ? walletAddress : '',
      username: isValidWallet ? this.formatUsername(walletAddress) : 'Anonymous',
      purchase_date: raw.purchasedate || raw.created_at,
      transaction_hash: raw.transactionhash,
      is_winner: false,
      entry_type: 'confirmed'
    };
  }

  // ==========================================================================
  // TICKETS - Manage ticket availability and reservations
  // ==========================================================================

  /**
   * Get unavailable tickets for a competition (sold + reserved)
   * Uses the Supabase RPC function get_unavailable_tickets for efficiency
   */
  async getUnavailableTickets(competitionId: string): Promise<number[]> {
    const cacheKey = `unavailable_tickets:${competitionId}`;
    const cached = dataCache.get<number[]>(cacheKey);
    if (cached) return cached;

    try {
      // Use Supabase RPC to get ALL unavailable tickets (sold + pending) in one call
      // The RPC function get_unavailable_tickets returns distinct ticket numbers that are not available
      // Queries pending_ticket_items.ticket_number (joined with pending_tickets for expires_at/status check)
      const { data: unavailableTickets, error: rpcError } = await getUnavailableTickets(supabase, competitionId);

      if (rpcError) {
        databaseLogger.warn('[OmnipotentData] RPC get_unavailable_tickets failed, using fallback', { error: rpcError.message });

        // Fallback: Query directly if RPC fails
        const unavailableSet = new Set<number>();

        // Get pending (reserved) tickets from pending_ticket_items
        // SCHEMA: pending_ticket_items has: id, pending_ticket_id, competition_id, ticket_number (INTEGER), created_at
        // We need to join with pending_tickets to check expires_at and status
        const pendingResult = await supabase
          .from('pending_ticket_items')
          .select(`
            ticket_number,
            pending_tickets!inner(
              expires_at,
              status
            )
          `)
          .eq('competition_id', competitionId) as { data: any; error: any };
        
        const { data: pendingItemsData } = pendingResult;

        if (pendingItemsData) {
          const now = new Date();
          pendingItemsData.forEach((item: any) => {
            const pending = item.pending_tickets;
            // Check if reservation is not expired and has valid status
            const isExpired = pending?.expires_at && new Date(pending.expires_at) < now;
            const validStatus = pending?.status && ['pending', 'confirming'].includes(pending.status);
            
            if (!isExpired && validStatus && typeof item.ticket_number === 'number') {
              unavailableSet.add(item.ticket_number);
            }
          });
        }

        // PRODUCTION FIX: Also get pending tickets from pending_tickets.ticket_numbers
        // Production schema has ticket_numbers column that is actively used
        // This handles case where pending_ticket_items is empty but pending_tickets has data
        const pendingTicketsResult = await supabase
          .from('pending_tickets')
          .select('ticket_numbers, expires_at, status')
          .eq('competition_id', competitionId)
          .in('status', ['pending', 'confirming']) as { data: any; error: any };
        
        const { data: pendingTicketsData } = pendingTicketsResult;

        if (pendingTicketsData) {
          const now = new Date();
          pendingTicketsData.forEach((row: any) => {
            // Check if reservation is not expired
            const isExpired = row.expires_at && new Date(row.expires_at) < now;
            
            if (!isExpired && Array.isArray(row.ticket_numbers)) {
              row.ticket_numbers.forEach((n: number) => {
                if (Number.isFinite(n) && n > 0) {
                  unavailableSet.add(n);
                }
              });
            }
          });
        }

        // Get sold tickets from v_joincompetition_active
        // SCHEMA: v_joincompetition_active has: competition_id, ticket_numbers (comma-separated string or array)
        const soldResult = await supabase
          .from('v_joincompetition_active')
          .select('ticket_numbers')
          .eq('competition_id', competitionId) as { data: any; error: any };
        
        const { data: soldData } = soldResult;

        if (soldData) {
          soldData.forEach((row: any) => {
            // Handle both comma-separated string and array formats
            let ticketNumbers: number[] = [];
            
            if (Array.isArray(row.ticket_numbers)) {
              // If it's an array (INTEGER[])
              ticketNumbers = row.ticket_numbers.filter((n: any) => Number.isFinite(n) && n > 0);
            } else if (typeof row.ticket_numbers === 'string') {
              // If it's a comma-separated string
              ticketNumbers = row.ticket_numbers
                .split(',')
                .map((x: string) => parseInt(x.trim(), 10))
                .filter((n: number) => Number.isFinite(n) && n > 0);
            }
            
            ticketNumbers.forEach((n: number) => unavailableSet.add(n));
          });
        }

        const unavailable = Array.from(unavailableSet).sort((a, b) => a - b);
        dataCache.set(cacheKey, unavailable, 5000); // Short cache for ticket availability
        return unavailable;
      }

      // RPC succeeded - return the result
      const unavailable = Array.isArray(unavailableTickets) ? unavailableTickets : [];
      dataCache.set(cacheKey, unavailable, 5000); // Short cache for ticket availability
      return unavailable;

    } catch (error) {
      databaseLogger.error('[OmnipotentData] Failed to fetch unavailable tickets', { competitionId, error });
      return [];
    }
  }

  /**
   * Get available tickets for a competition
   * Returns array of available ticket numbers based on total tickets minus unavailable
   * Uses caching to prevent redundant queries
   */
  async getAvailableTickets(competitionId: string, totalTickets: number): Promise<number[]> {
    const cacheKey = `available_tickets:${competitionId}:${totalTickets}`;
    const cached = dataCache.get<number[]>(cacheKey);
    if (cached) {
      databaseLogger.debug('[OmnipotentData] Returning cached available tickets', { 
        competitionId: competitionId.slice(0, 8) + '...', 
        count: cached.length 
      });
      return cached;
    }

    try {
      const startTime = Date.now();
      databaseLogger.debug('[OmnipotentData] Fetching available tickets', {
        competitionId: competitionId.slice(0, 8) + '...',
        totalTickets
      });

      // Get unavailable tickets (this is cached with 5s TTL)
      const unavailable = await this.getUnavailableTickets(competitionId);
      const unavailableSet = new Set(unavailable);

      // Calculate available tickets
      const allTickets = Array.from({ length: totalTickets }, (_, i) => i + 1);
      const available = allTickets.filter(ticket => !unavailableSet.has(ticket));

      const duration = Date.now() - startTime;
      databaseLogger.info('[OmnipotentData] Available tickets calculated', {
        competitionId: competitionId.slice(0, 8) + '...',
        total: totalTickets,
        unavailable: unavailable.length,
        available: available.length,
        duration: `${duration}ms`
      });

      // Cache for 3 seconds - short enough to stay fresh, long enough to prevent rapid refetches
      dataCache.set(cacheKey, available, 3000);
      return available;

    } catch (error) {
      databaseLogger.error('[OmnipotentData] Failed to fetch available tickets', { competitionId, error });
      // Return empty array on error to fail safely - prevents showing sold tickets as available
      // This is consistent with getUnavailableTickets() which returns empty array on error
      return [];
    }
  }

  /**
   * DEPRECATED: Client-side cleanup is no longer needed.
   * The reserve_lucky_dip RPC handles expiry atomically within the database transaction.
   * This method is now a no-op to maintain backward compatibility.
   */
  private async cleanupExpiredReservations(competitionId: string): Promise<void> {
    // NOTE: Client-side DELETE operations have been removed.
    // The reserve_lucky_dip RPC now handles expiry atomically to prevent race conditions.
    databaseLogger.info('[OmnipotentData] Cleanup is now handled by reserve_lucky_dip RPC', { competitionId });
  }

  /**
   * Reserve tickets for a user with aggressive retry logic
   *
   * CRITICAL FIX: Now reselects fresh tickets on conflict instead of retrying same failed tickets.
   * When tickets are unavailable, fetches fresh available pool and picks new random tickets.
   * Only fails when truly insufficient tickets remain, with honest error message.
   *
   * Uses direct database operations with automatic retry and cleanup.
   * Implements exponential backoff and proactive error recovery.
   */
  async reserveTicketsAggressive(
    userIdentifier: string,
    competitionId: string,
    ticketNumbers: number[],
    maxRetries: number = 3
  ): Promise<{ success: boolean; reservationId?: string; error?: string; retried?: boolean }> {
    databaseLogger.info('[OmnipotentData] Aggressive ticket reservation started', {
      competitionId,
      ticketCount: ticketNumbers.length,
      maxRetries
    });

    // Proactively clean up expired reservations before attempting
    await this.cleanupExpiredReservations(competitionId);

    let lastError: string = '';
    let retried = false;
    let currentSelection = [...ticketNumbers];

    // Get total tickets for the competition (needed for reselection)
    const { data: competition } = await supabase
      .from('competitions')
      .select('total_tickets')
      .eq('id', competitionId)
      .single();
    
    const totalTickets = competition?.total_tickets || 0;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (attempt > 1) {
        retried = true;
        // Exponential backoff: 100ms, 200ms, 400ms
        const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000);
        databaseLogger.info('[OmnipotentData] Retrying reservation', { attempt, delay });
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Clean up again before retry
        await this.cleanupExpiredReservations(competitionId);
      }

      const result = await this.reserveTickets(userIdentifier, competitionId, currentSelection);
      
      if (result.success) {
        databaseLogger.info('[OmnipotentData] Reservation succeeded', { 
          attempt, 
          retried,
          reservationId: result.reservationId 
        });
        return { ...result, retried };
      }

      lastError = result.error || 'Unknown error';
      
      // Don't retry on certain errors
      if (lastError.includes('not found') || 
          lastError.includes('not active') || 
          lastError.includes('ended') ||
          lastError.includes('out of range')) {
        databaseLogger.warn('[OmnipotentData] Non-retryable error', { error: lastError });
        return result;
      }

      // CRITICAL FIX: If tickets are unavailable, reselect from fresh available pool
      if (lastError.includes('no longer available') && attempt < maxRetries) {
        databaseLogger.info('[OmnipotentData] Tickets unavailable, fetching fresh pool', { attempt });
        
        try {
          // Get fresh list of available tickets
          const freshAvailable = await this.getAvailableTickets(competitionId, totalTickets);
          
          if (freshAvailable.length < ticketNumbers.length) {
            // Not enough tickets - fail with honest message
            const honestError = `Only ${freshAvailable.length} tickets available, but you requested ${ticketNumbers.length}. Please reduce your selection.`;
            databaseLogger.warn('[OmnipotentData] Insufficient tickets for reselection', { 
              available: freshAvailable.length, 
              requested: ticketNumbers.length 
            });
            return {
              success: false,
              error: honestError,
              retried
            };
          }
          
          // Pick NEW random tickets from fresh available pool
          const shuffled = [...freshAvailable].sort(() => Math.random() - 0.5);
          currentSelection = shuffled.slice(0, ticketNumbers.length);
          
          databaseLogger.info('[OmnipotentData] Reselected fresh tickets', { 
            newSelection: currentSelection.slice(0, 5).concat(currentSelection.length > 5 ? ['...'] : []),
            totalSelected: currentSelection.length
          });
          
          // Continue to next retry attempt with fresh selection
          continue;
        } catch (err) {
          databaseLogger.error('[OmnipotentData] Failed to fetch fresh tickets for reselection', err);
          // Fall through to normal retry logic
        }
      }

      databaseLogger.warn('[OmnipotentData] Reservation attempt failed', { 
        attempt, 
        error: lastError,
        willRetry: attempt < maxRetries 
      });
    }

    databaseLogger.error('[OmnipotentData] All reservation attempts failed', { 
      maxRetries, 
      lastError 
    });
    
    return {
      success: false,
      error: `Failed to reserve tickets after ${maxRetries} attempts: ${lastError}`,
      retried
    };
  }

  /**
   * Reserve tickets for a user
   *
   * Uses direct database operations (same approach as edge functions)
   * to avoid dependency on RPC functions that may not be deployed.
   */
  async reserveTickets(
    userIdentifier: string,
    competitionId: string,
    ticketNumbers: number[]
  ): Promise<{ success: boolean; reservationId?: string; error?: string }> {
    // SCHEMA VALIDATION DISABLED - was causing 404 errors with exec_sql
    // The reservation schema is assumed to exist; edge function will handle validation

    const identity = await this.ensureUserIdentity(userIdentifier);
    if (!identity) {
      return { success: false, error: 'User identity not resolved' };
    }

    try {
      const reservationId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes (extended from 2 to prevent expiry during payment)
      const userId = identity.canonicalUserId;
      const normalizedUserId = userId.toLowerCase();

      // Step 1: Verify competition exists and is active
      const { data: competition, error: compError } = await supabase
        .from('competitions')
        .select('id, uid, status, total_tickets, end_date')
        .eq('id', competitionId)
        .single();

      if (compError || !competition) {
        return { success: false, error: 'Competition not found' };
      }

      if (competition.status !== 'active') {
        return { success: false, error: 'Competition is not currently active' };
      }

      // Check if competition has ended
      if (competition.end_date) {
        const endDate = new Date(competition.end_date);
        if (!isNaN(endDate.getTime()) && endDate < new Date()) {
          return { success: false, error: 'Competition has ended' };
        }
      }

      // Validate ticket numbers are within range
      const maxTicket = competition.total_tickets || 0;
      const outOfRange = ticketNumbers.filter(t => t > maxTicket || t < 1);
      if (outOfRange.length > 0) {
        return { success: false, error: `Tickets out of range (max ${maxTicket}): ${outOfRange.join(', ')}` };
      }

      // Step 2: Get currently unavailable tickets
      const unavailableSet = new Set<number>();
      const now = new Date();

      // Get pending tickets (reserved but not yet paid)
      const { data: pendingData } = await supabase
        .from('pending_tickets')
        .select('ticket_numbers, user_id, expires_at')
        .eq('competition_id', competitionId)
        .in('status', ['pending', 'confirming']);

      if (pendingData) {
        pendingData.forEach((row) => {
          const normalizedRowUserId = ((row as any).user_id || '').toLowerCase();
          // Exclude the current user's own expired reservations
          if (normalizedRowUserId === normalizedUserId && (row as any).expires_at && new Date((row as any).expires_at) < now) {
            return;
          }
          // Include other users' pending tickets
          if (normalizedRowUserId !== normalizedUserId && Array.isArray(row.ticket_numbers)) {
            row.ticket_numbers.forEach((n: number) => {
              if (Number.isFinite(n)) unavailableSet.add(n);
            });
          }
        });
      }

      // Get sold tickets from v_joincompetition_active
      const { data: soldData } = await supabase
        .from('v_joincompetition_active')
        .select('ticket_numbers')
        .eq('competition_id', competitionId);

      if (soldData) {
        soldData.forEach((row: { ticket_numbers: string | null }) => {
          const nums = String(row.ticket_numbers || '')
            .split(',')
            .map((x: string) => parseInt(x.trim(), 10))
            .filter((n: number) => Number.isFinite(n) && n > 0);
          nums.forEach((n: number) => unavailableSet.add(n));
        });
      }

      // Step 3: Check if requested tickets are available
      const conflictingTickets = ticketNumbers.filter(t => unavailableSet.has(t));
      if (conflictingTickets.length > 0) {
        return {
          success: false,
          error: `Some selected tickets are no longer available: ${conflictingTickets.join(', ')}`
        };
      }

      // Step 4: Create reservation
      const ticketPrice = 1; // Default price, will be updated by payment flow
      const totalAmount = ticketPrice * ticketNumbers.length;

      const { error: insertError } = await supabase
        .from('pending_tickets')
        .insert({
          id: reservationId,
          user_id: userId,
          competition_id: competitionId,
          ticket_numbers: ticketNumbers,
          ticket_count: ticketNumbers.length,
          ticket_price: ticketPrice,
          total_amount: totalAmount,
          status: 'pending',
          expires_at: expiresAt.toISOString(),
          created_at: new Date().toISOString()
        });

      if (insertError) {
        // Check for unique constraint violation (race condition)
        if (insertError.code === '23505') {
          return {
            success: false,
            error: 'Some tickets were reserved by another user. Please try again.'
          };
        }
        throw insertError;
      }

      // Success - invalidate cache
      dataCache.invalidate(`unavailable_tickets:${competitionId}`);
      dataCache.invalidate(`available_tickets:${competitionId}`);

      return {
        success: true,
        reservationId
      };

    } catch (error: any) {
      databaseLogger.error('[OmnipotentData] Ticket reservation failed', error);
      return {
        success: false,
        error: error.message || 'Failed to reserve tickets'
      };
    }
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Parse ticket numbers from various formats
   */
  private parseTicketNumbers(input: any): number[] {
    if (Array.isArray(input)) {
      return input.filter(n => Number.isFinite(n));
    }
    
    if (typeof input === 'string') {
      return input
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => Number.isFinite(n) && n > 0);
    }

    return [];
  }

  /**
   * Format wallet address for display
   */
  private formatUsername(walletAddress: string): string {
    if (!walletAddress || walletAddress === 'Unknown') return 'Anonymous';
    if (walletAddress.startsWith('0x') && walletAddress.length >= 10) {
      return `${walletAddress.substring(0, 6)}...${walletAddress.slice(-4)}`;
    }
    return walletAddress.substring(0, 10);
  }

  /**
   * Normalize image URLs for consistent display
   */
  private normalizeImageUrl(url: string | null): string {
    if (!url) return '';

    if (url.startsWith('http://') || url.startsWith('https://')) {
      // Fix malformed Supabase URLs
      // Note: The storage bucket is "Competition%20Images" with a subfolder also named "Competition Images"
      // Correct path: /Competition%20Images/Competition%20Images/<filename>
      // Malformed path: /Competition%20Images/<filename> (missing subfolder)
      const supabasePattern = /supabase\.co\/storage\/v1\/object\/public\/Competition%20Images\/([^/]+\.(jpg|jpeg|png|gif|webp|svg|bmp))$/i;
      const match = url.match(supabasePattern);
      if (match) {
        const filename = match[1];
        // Use environment-configured Supabase URL and add the missing subfolder
        return `${SUPABASE_URL}/storage/v1/object/public/Competition%20Images/Competition%20Images/${filename}`;
      }
      return url;
    }

    return url;
  }

  /**
   * Clear all cached data
   */
  clearCache(pattern?: string): void {
    dataCache.invalidate(pattern);
    databaseLogger.info('[OmnipotentData] Cache cleared', { pattern });
  }

  /**
   * Force refresh data (clear cache and refetch)
   */
  async refresh(type: 'competitions' | 'entries' | 'all' = 'all'): Promise<void> {
    if (type === 'all' || type === 'competitions') {
      dataCache.invalidate('competitions:');
      dataCache.invalidate('competition:');
      dataCache.invalidate('unavailable_tickets:');
      dataCache.invalidate('available_tickets:');
    }
    
    if (type === 'all' || type === 'entries') {
      dataCache.invalidate('entries:');
      dataCache.invalidate('competition_entries:');
    }

    databaseLogger.info('[OmnipotentData] Data refreshed', { type });
  }

  // ==========================================================================
  // AGGRESSIVE OPERATIONS - Direct CRUD with auto-fix
  // ==========================================================================

  /**
   * Aggressive SELECT - with auto-fix for missing tables/columns
   */
  async aggressiveSelect<T = any>(
    table: string,
    columns: string = '*',
    filters?: Record<string, any>
  ): Promise<{ data: T[] | null; error: any }> {
    if (!this.aggressiveMode || !hasAdminAccess()) {
      // Fallback to regular query
      let query = supabase.from(table).select(columns);
      if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
          query = query.eq(key, value);
        });
      }
      return await query as any;
    }

    return await aggressiveCRUD.select<T>(table, columns, filters, {
      autoFix: true,
      useAdmin: true,
    });
  }

  /**
   * Aggressive INSERT - with auto-fix for missing tables/columns
   */
  async aggressiveInsert<T = any>(
    table: string,
    data: any
  ): Promise<{ data: T | null; error: any }> {
    if (!this.aggressiveMode || !hasAdminAccess()) {
      // Fallback to regular insert
      return await supabase.from(table).insert(data).select().single() as any;
    }

    return await aggressiveCRUD.insert<T>(table, data, {
      autoFix: true,
      useAdmin: true,
    });
  }

  /**
   * Aggressive UPDATE - with auto-fix for missing columns
   */
  async aggressiveUpdate<T = any>(
    table: string,
    data: any,
    filters: Record<string, any>
  ): Promise<{ data: T | null; error: any }> {
    if (!this.aggressiveMode || !hasAdminAccess()) {
      // Fallback to regular update
      let query = supabase.from(table).update(data);
      Object.entries(filters).forEach(([key, value]) => {
        query = query.eq(key, value);
      });
      return await query.select().single() as any;
    }

    return await aggressiveCRUD.update<T>(table, data, filters, {
      autoFix: true,
      useAdmin: true,
    });
  }

  /**
   * Aggressive UPSERT - with auto-fix
   */
  async aggressiveUpsert<T = any>(
    table: string,
    data: any,
    onConflict?: string
  ): Promise<{ data: T | null; error: any }> {
    if (!this.aggressiveMode || !hasAdminAccess()) {
      // Fallback to regular upsert
      const opts = onConflict ? { onConflict } : undefined;
      return await supabase.from(table).upsert(data, opts).select().single() as any;
    }

    return await aggressiveCRUD.upsert<T>(table, data, {
      autoFix: true,
      useAdmin: true,
      onConflict,
    });
  }

  /**
   * Aggressive DELETE
   */
  async aggressiveDelete(
    table: string,
    filters: Record<string, any>
  ): Promise<{ data: any | null; error: any }> {
    if (!this.aggressiveMode || !hasAdminAccess()) {
      // Fallback to regular delete
      let query = supabase.from(table).delete();
      Object.entries(filters).forEach(([key, value]) => {
        query = query.eq(key, value);
      });
      return await query as any;
    }

    return await aggressiveCRUD.delete(table, filters, {
      autoFix: true,
      useAdmin: true,
    });
  }
}

// ============================================================================
// Export singleton instance
// ============================================================================

export const omnipotentData = new OmnipotentDataService();
export default omnipotentData;
