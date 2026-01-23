import { supabase } from './supabase';

/**
 * API Security Module
 *
 * Provides rate limiting, input validation, and authorization checks
 * for securing competition and ticket-related API operations.
 */

// In-memory rate limit store (for client-side rate limiting)
// In production, use Redis or database-backed storage
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

/**
 * Rate Limiting
 * Prevents abuse by limiting the number of requests per user/action
 */
export async function withRateLimit(
  userId: string,
  action: string,
  limit: number = 10,
  windowMs: number = 60000 // 1 minute default
): Promise<boolean> {
  const key = `rate_limit:${userId}:${action}`;
  const now = Date.now();

  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetTime) {
    // First request or window expired - reset
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (entry.count >= limit) {
    const remainingTime = Math.ceil((entry.resetTime - now) / 1000);
    throw new Error(`Rate limit exceeded for ${action}. Try again in ${remainingTime} seconds.`);
  }

  entry.count++;
  return true;
}

/**
 * Get current rate limit count for a key
 */
export function getRateLimitCount(userId: string, action: string): number {
  const key = `rate_limit:${userId}:${action}`;
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetTime) {
    return 0;
  }

  return entry.count;
}

/**
 * Clear rate limit for testing or admin purposes
 */
export function clearRateLimit(userId: string, action: string): void {
  const key = `rate_limit:${userId}:${action}`;
  rateLimitStore.delete(key);
}

/**
 * Input Validation
 * Validates ticket numbers and other inputs
 */
export function validateTicketNumbers(
  ticketNumbers: unknown,
  maxTickets: number = 10,
  ticketRange: { min: number; max: number } = { min: 1, max: 1000 }
): { valid: boolean; error?: string } {
  if (!Array.isArray(ticketNumbers)) {
    return { valid: false, error: 'Ticket numbers must be an array' };
  }

  if (ticketNumbers.length === 0) {
    return { valid: false, error: 'At least one ticket number is required' };
  }

  if (ticketNumbers.length > maxTickets) {
    return { valid: false, error: `Maximum ${maxTickets} tickets allowed per purchase` };
  }

  // Check for duplicates
  const uniqueTickets = new Set(ticketNumbers);
  if (uniqueTickets.size !== ticketNumbers.length) {
    return { valid: false, error: 'Duplicate ticket numbers are not allowed' };
  }

  // Validate each ticket number
  for (const num of ticketNumbers) {
    if (!Number.isInteger(num)) {
      return { valid: false, error: `Invalid ticket number: ${num} (must be an integer)` };
    }
    if (num < ticketRange.min || num > ticketRange.max) {
      return {
        valid: false,
        error: `Ticket number ${num} out of range (${ticketRange.min}-${ticketRange.max})`
      };
    }
  }

  return { valid: true };
}

/**
 * Validate UUID format
 */
export function validateUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return typeof uuid === 'string' && uuidRegex.test(uuid);
}

/**
 * Validate competition ID
 */
export function validateCompetitionId(competitionId: unknown): { valid: boolean; error?: string } {
  if (typeof competitionId !== 'string') {
    return { valid: false, error: 'Competition ID must be a string' };
  }

  if (!competitionId.trim()) {
    return { valid: false, error: 'Competition ID is required' };
  }

  if (!validateUUID(competitionId)) {
    return { valid: false, error: 'Invalid competition ID format' };
  }

  return { valid: true };
}

/**
 * Validate user ID
 */
export function validateUserId(userId: unknown): { valid: boolean; error?: string } {
  if (typeof userId !== 'string') {
    return { valid: false, error: 'User ID must be a string' };
  }

  if (!userId.trim()) {
    return { valid: false, error: 'User ID is required' };
  }

  return { valid: true };
}

/**
 * Authorization Checks
 * Validates user access to competitions and actions
 */
export async function validateCompetitionAccess(
  userId: string,
  competitionId: string,
  action: 'view' | 'join' | 'admin'
): Promise<{
  authorized: boolean;
  competition?: any;
  user?: any;
  error?: string;
}> {
  try {
    // Validate inputs
    const userValidation = validateUserId(userId);
    if (!userValidation.valid) {
      return { authorized: false, error: userValidation.error };
    }

    const compValidation = validateCompetitionId(competitionId);
    if (!compValidation.valid) {
      return { authorized: false, error: compValidation.error };
    }

    // Fetch competition
    const { data: competition, error: compError } = await supabase
      .from('competitions')
      .select('id, status, created_by, title, is_instant_win, total_tickets')
      .eq('id', competitionId)
      .maybeSingle();

    if (compError || !competition) {
      return { authorized: false, error: 'Competition not found' };
    }

    // Fetch user
    const { data: user, error: userError } = await supabase
      .from('canonical_users')
      .select('id, privy_user_id, is_admin, wallet_address')
      .or(`privy_user_id.eq.${userId},id.eq.${userId}`)
      .maybeSingle();

    // Action-specific authorization
    switch (action) {
      case 'view':
        // Anyone can view competitions
        return { authorized: true, competition, user };

      case 'join':
        // Check if competition is active
        if (competition.status !== 'active') {
          return {
            authorized: false,
            error: 'Competition is not accepting entries',
            competition
          };
        }
        return { authorized: true, competition, user };

      case 'admin':
        // Check if user is admin or competition creator
        if (!user) {
          return { authorized: false, error: 'User not found' };
        }
        if (!(user as any).is_admin && competition.created_by !== userId) {
          return {
            authorized: false,
            error: 'Admin access required',
            competition,
            user
          };
        }
        return { authorized: true, competition, user };

      default:
        return { authorized: false, error: 'Unknown action' };
    }
  } catch (error) {
    console.error('Error validating competition access:', error);
    return {
      authorized: false,
      error: error instanceof Error ? error.message : 'Authorization check failed'
    };
  }
}

/**
 * Sanitize user input to prevent XSS and injection attacks
 */
export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .slice(0, 1000); // Limit length
}

/**
 * Validate wallet address format
 */
export function validateWalletAddress(address: unknown): { valid: boolean; error?: string } {
  if (typeof address !== 'string') {
    return { valid: false, error: 'Wallet address must be a string' };
  }

  const trimmed = address.trim();

  if (!trimmed) {
    return { valid: false, error: 'Wallet address is required' };
  }

  // Ethereum address format (0x + 40 hex chars)
  const ethRegex = /^0x[a-fA-F0-9]{40}$/;
  // Solana address format (base58, 32-44 chars)
  const solRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

  if (!ethRegex.test(trimmed) && !solRegex.test(trimmed)) {
    return { valid: false, error: 'Invalid wallet address format' };
  }

  return { valid: true };
}

/**
 * Create a secure request validator
 */
export function createRequestValidator() {
  return {
    validateTickets: validateTicketNumbers,
    validateCompetitionId,
    validateUserId,
    validateWalletAddress,
    validateUUID,
    sanitize: sanitizeInput,
    async checkAccess(userId: string, competitionId: string, action: 'view' | 'join' | 'admin') {
      return validateCompetitionAccess(userId, competitionId, action);
    },
    async rateLimit(userId: string, action: string, limit?: number, windowMs?: number) {
      return withRateLimit(userId, action, limit, windowMs);
    }
  };
}

// Export a singleton validator instance
export const requestValidator = createRequestValidator();
