import { supabase } from './supabase';

/**
 * Secure API Client
 *
 * Provides methods to interact with the server-side secure-write endpoint,
 * which handles database writes that require service role privileges.
 *
 * Authentication is handled via:
 * 1. Access token (passed explicitly from auth context)
 * 2. Supabase session token (fallback)
 * 3. User ID passed in request body (validated server-side)
 */

interface SecureApiResponse<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

// Store for the access token (set by components with auth context access)
let authAccessToken: string | null = null;

/**
 * Set the access token for API authentication.
 * Should be called by components that have access to useAuthUser().
 */
export function setPrivyAccessToken(token: string | null): void {
  authAccessToken = token;
  if (token) {
    console.log('Access token set in secure-api');
  }
}

/**
 * Get the current auth token.
 * Tries multiple sources in order of preference.
 */
async function getAuthToken(): Promise<string | null> {
  // First try explicitly set token
  if (authAccessToken) {
    return authAccessToken;
  }

  // For CDP/Base auth, use the wallet address as the auth identifier
  // This is set by AuthContext when CDP sign-in completes
  try {
    const walletAddress = localStorage.getItem('cdp:wallet_address') ||
                          localStorage.getItem('base:wallet_address');
    if (walletAddress) {
      // Create a bearer token with wallet address prefix
      // Backend validates this against the user's session
      console.log('Using CDP wallet address as auth token');
      return `wallet:${walletAddress}`;
    }
  } catch {
    // localStorage not available, continue to fallback
  }

  // Try to get token from localStorage (set by auth SDK - supports legacy Privy)
  try {
    const storedToken = localStorage.getItem('privy:token') ||
                        localStorage.getItem('privy:access_token');
    if (storedToken) {
      return storedToken;
    }

    // Try to parse auth state from localStorage (legacy Privy format)
    const authState = localStorage.getItem('privy:authState');
    if (authState) {
      try {
        const parsed = JSON.parse(authState);
        if (parsed.accessToken) {
          return parsed.accessToken;
        }
      } catch {
        // Continue to fallback
      }
    }
  } catch {
    // localStorage not available, continue to fallback
  }

  // Fallback to Supabase session
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

async function secureRequest<T>(
  route: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>,
  options?: { accessToken?: string }
): Promise<SecureApiResponse<T>> {
  try {
    // Use explicitly provided token, or fall back to stored/session token
    const token = options?.accessToken || await getAuthToken();

    if (!token) {
      return { ok: false, error: 'Not authenticated - please log in' };
    }

    const response = await fetch(`/api/secure-write/${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return { ok: false, error: data.error || `Request failed with status ${response.status}` };
    }

    return { ok: true, data };
  } catch (err) {
    console.error(`Secure API error (${route}):`, err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error'
    };
  }
}

/**
 * Create a wallet top-up order
 */
export async function createTopUpOrder(params: {
  amount: number;
  payment_method?: 'USDC' | 'USDT' | 'SOL' | 'card';
  wallet_address?: string;
}, options?: { accessToken?: string }): Promise<SecureApiResponse<{ order: unknown }>> {
  return secureRequest('orders/topup', 'POST', params, options);
}

/**
 * Create a competition ticket purchase order
 */
export async function createPurchaseOrder(params: {
  competition_id: string;
  ticket_count: number;
  amount_usd: number;
  payment_method?: 'USDC' | 'USDT' | 'SOL' | 'card';
  selected_tickets?: number[];
}, options?: { accessToken?: string }): Promise<SecureApiResponse<{ order: unknown }>> {
  return secureRequest('orders/purchase', 'POST', params, options);
}

/**
 * Update the current user's profile
 */
export async function updateProfile(updates: {
  username?: string;
  email?: string;
  telegram_handle?: string;
  telephone_number?: string;
  avatar_url?: string;
}, options?: { accessToken?: string }): Promise<SecureApiResponse<{ profile: unknown }>> {
  return secureRequest('profile', 'PATCH', updates, options);
}

/**
 * Join a competition with tickets
 */
export async function joinCompetition(params: {
  competition_id: string;
  number_of_tickets: number;
  ticket_numbers?: number[];
  amount_spent?: number;
  wallet_address?: string;
}, options?: { accessToken?: string }): Promise<SecureApiResponse<{ entry: unknown }>> {
  return secureRequest('competition/join', 'POST', params, options);
}

/**
 * Make a public request without authentication.
 * Used for endpoints that don't require user authentication.
 */
async function publicRequest<T>(
  route: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>
): Promise<SecureApiResponse<T>> {
  try {
    const response = await fetch(`/api/secure-write/${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return { ok: false, error: data.error || `Request failed with status ${response.status}` };
    }

    return { ok: true, data };
  } catch (err) {
    console.error(`Public API error (${route}):`, err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error'
    };
  }
}

/**
 * Get unavailable tickets for a competition (sold + pending reservations)
 * This uses the server-side Netlify function to bypass RLS restrictions.
 * This is a PUBLIC endpoint - no authentication required.
 */
export async function getUnavailableTickets(params: {
  competition_id: string;
  exclude_user_id?: string;
}): Promise<SecureApiResponse<{
  unavailableTickets: number[];
  count: number;
  timestamp: string;
}>> {
  return publicRequest('tickets/unavailable', 'POST', params);
}

/**
 * Reserve tickets atomically for a competition
 * This uses the server-side Netlify function to bypass RLS and handle race conditions
 */
export async function reserveTickets(params: {
  competition_id: string;
  selected_tickets: number[];
  ticket_price?: number;
  session_id?: string;
}, options?: { accessToken?: string }): Promise<SecureApiResponse<{
  reservationId: string;
  ticketNumbers: number[];
  ticketCount: number;
  totalAmount: number;
  expiresAt: string;
  message: string;
}>> {
  return secureRequest('tickets/reserve', 'POST', params, options);
}

export const secureApi = {
  createTopUpOrder,
  createPurchaseOrder,
  updateProfile,
  joinCompetition,
  getUnavailableTickets,
  reserveTickets,
  setPrivyAccessToken,
};
