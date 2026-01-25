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
 * 
 * This service acts as a single source of truth for all data operations.
 */

import { supabase } from './supabase';
import { resolveUserIdentity, type ResolvedIdentity } from './identity';
import { databaseLogger } from './debug-console';

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

      const { data, error } = await query;

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
      const { data, error } = await supabase
        .from('competitions')
        .select('*')
        .eq('id', competitionId)
        .single();

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
      const { data, error } = await supabase
        .rpc('get_comprehensive_user_dashboard_entries', {
          user_identifier: identity.canonicalUserId
        });

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

      const { data: standardData, error: standardError } = await supabase
        .rpc('get_competition_entries', {
          competition_identifier: competitionId
        });

      if (!standardError && standardData) {
        data = standardData;
      } else {
        // Fallback to bypass_rls version if standard fails
        console.log('[OmnipotentData] Standard RPC unavailable, trying bypass_rls');
        const { data: bypassData, error: bypassError } = await supabase
          .rpc('get_competition_entries_bypass_rls', {
            competition_identifier: competitionId
          });
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
    const walletAddress = raw.walletaddress || raw.privy_user_id || '';
    
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
      // Uses pending_tickets.ticket_numbers (array), filters where expires_at > now() and status IN ('pending','confirming')
      const { data: unavailableTickets, error: rpcError } = await supabase
        .rpc('get_unavailable_tickets', { competition_id: competitionId });

      if (rpcError) {
        databaseLogger.warn('[OmnipotentData] RPC get_unavailable_tickets failed, using fallback', { error: rpcError.message });

        // Fallback: Query directly if RPC fails
        const unavailableSet = new Set<number>();

        // Get pending (reserved) tickets
        const { data: pendingData } = await supabase
          .from('pending_tickets')
          .select('ticket_numbers, expires_at')
          .eq('competition_id', competitionId)
          .in('status', ['pending', 'confirming']);

        if (pendingData) {
          const now = new Date();
          pendingData.forEach(row => {
            const isExpired = row.expires_at && new Date(row.expires_at) < now;
            if (!isExpired && Array.isArray(row.ticket_numbers)) {
              row.ticket_numbers.forEach((num: any) => unavailableSet.add(num));
            }
          });
        }

        // Get sold tickets from v_joincompetition_active
        const { data: soldData } = await supabase
          .from('v_joincompetition_active')
          .select('ticketnumbers')
          .eq('competitionid', competitionId);

        if (soldData) {
          soldData.forEach(row => {
            const nums = String(row.ticketnumbers || '')
              .split(',')
              .map(x => parseInt(x.trim(), 10))
              .filter(n => Number.isFinite(n) && n > 0);
            nums.forEach(n => unavailableSet.add(n));
          });
        }

        const unavailable = Array.from(unavailableSet);
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
    const identity = await this.ensureUserIdentity(userIdentifier);
    if (!identity) {
      return { success: false, error: 'User identity not resolved' };
    }

    try {
      const reservationId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
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
        .select('ticketnumbers')
        .eq('competitionid', competitionId);

      if (soldData) {
        soldData.forEach((row: { ticketnumbers: string | null }) => {
          const nums = String(row.ticketnumbers || '')
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
    }
    
    if (type === 'all' || type === 'entries') {
      dataCache.invalidate('entries:');
      dataCache.invalidate('competition_entries:');
    }

    databaseLogger.info('[OmnipotentData] Data refreshed', { type });
  }
}

// ============================================================================
// Export singleton instance
// ============================================================================

export const omnipotentData = new OmnipotentDataService();
export default omnipotentData;
