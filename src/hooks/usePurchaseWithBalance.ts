/**
 * Example React Hook: usePurchaseWithBalance
 * 
 * Handles ticket purchases using balance payment via Netlify proxy.
 * The proxy calls the purchase_tickets_with_balance RPC function.
 * Includes idempotency, error handling, and retry logic.
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { 
 *     purchase, 
 *     loading, 
 *     error, 
 *     result 
 *   } = usePurchaseWithBalance();
 *   
 *   const handlePurchase = async () => {
 *     await purchase({
 *       userId: user.id,
 *       competitionId: comp.id,
 *       ticketNumbers: [1, 2, 3],
 *       ticketPrice: 1.00
 *     });
 *   };
 *   
 *   if (result) {
 *     return <div>Success! New balance: ${result.new_balance}</div>;
 *   }
 *   
 *   return (
 *     <button onClick={handlePurchase} disabled={loading}>
 *       {loading ? 'Processing...' : 'Purchase'}
 *     </button>
 *   );
 * }
 * ```
 */

import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { idempotencyKeyManager } from '@/lib/idempotency-keys';
import { toCanonicalUserId } from '@/lib/canonicalUserId';
import type { 
  PurchaseWithBalanceOptions,
  PurchaseTicketsSuccessResponse 
} from '@/types/purchase-tickets';
import type { RPCPurchaseRequest } from '@/lib/balance-payment-service';

interface UsePurchaseWithBalanceResult {
  /** Function to initiate purchase */
  purchase: (options: PurchaseWithBalanceOptions) => Promise<boolean>;
  
  /** Loading state */
  loading: boolean;
  
  /** Error message (null if no error) */
  error: string | null;
  
  /** Success result (null if not successful yet) */
  result: PurchaseTicketsSuccessResponse | null;
  
  /** Current retry count */
  retryCount: number;
  
  /** Reset state */
  reset: () => void;
}

export function usePurchaseWithBalance(): UsePurchaseWithBalanceResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PurchaseTicketsSuccessResponse | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  
  // Store idempotency key for current purchase attempt
  const idempotencyKeyRef = useRef<string | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setResult(null);
    setRetryCount(0);
    idempotencyKeyRef.current = null;
    
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);
  
  const purchase = useCallback(async (options: PurchaseWithBalanceOptions): Promise<boolean> => {
    const {
      userId,
      competitionId,
      ticketNumbers,
      ticketPrice,
      reservationId
    } = options;
    
    // Validate inputs
    if (!userId || !competitionId || !ticketNumbers?.length || !ticketPrice) {
      setError('Missing required parameters');
      return false;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      // Convert userId to canonical format
      const canonicalUserId = toCanonicalUserId(userId);
      
      // Get or create idempotency key
      // For subsequent retries, this will return the same key
      let idempotencyKey = idempotencyKeyRef.current;
      if (!idempotencyKey) {
        idempotencyKey = reservationId
          ? idempotencyKeyManager.getOrCreateKey(reservationId)
          : crypto.randomUUID();
        idempotencyKeyRef.current = idempotencyKey;
      }
      
      console.log('[usePurchaseWithBalance] Attempting purchase', {
        userId: canonicalUserId.substring(0, 20) + '...',
        competitionId: competitionId.substring(0, 10) + '...',
        ticketCount: ticketNumbers.length,
        ticketPrice,
        idempotencyKey,
        retryCount: retryCount,
        hasReservation: !!reservationId
      });
      
      // Build request body - must match RPC function parameters
      const requestBody: RPCPurchaseRequest = {
        p_user_identifier: canonicalUserId,
        p_competition_id: competitionId,
        p_ticket_price: ticketPrice,
        p_ticket_count: ticketNumbers.length,
        p_ticket_numbers: ticketNumbers,
        p_idempotency_key: idempotencyKey
      };
      
      // Include p_reservation_id if provided (for 7-arg reserved variant)
      if (reservationId) {
        requestBody.p_reservation_id = reservationId;
      }
      
      // Get authentication token
      let authHeader = '';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          authHeader = `Bearer ${session.access_token}`;
        }
      } catch (e) {
        console.warn('[usePurchaseWithBalance] Could not get auth session:', e);
      }

      // Call the new Edge Function endpoint
      let data: any = null;
      let invokeError: { message: string } | null = null;

      try {
        const proxyResponse = await fetch('https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-handler/purchase-with-balance', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { Authorization: authHeader } : {}),
          },
          body: JSON.stringify(requestBody),
        });

        try {
          data = await proxyResponse.json();
        } catch {
          invokeError = { message: 'Invalid response from server' };
        }

        // If HTTP error with error body, treat as invocation error
        if (!proxyResponse.ok && data?.error) {
          const errMsg = typeof data.error === 'object' ? data.error.message : data.error;
          invokeError = { message: errMsg || 'Purchase failed' };
          data = null;
        }
      } catch (fetchErr) {
        invokeError = { message: fetchErr instanceof Error ? fetchErr.message : 'Failed to fetch' };
      }

      // Handle invocation errors
      if (invokeError) {
        console.error('[usePurchaseWithBalance] Invocation error:', invokeError);

        // Check if retryable (network errors)
        const isNetworkError = invokeError.message?.includes('network') ||
                               invokeError.message?.includes('timeout') ||
                               invokeError.message?.includes('fetch') ||
                               invokeError.message?.includes('Failed to fetch');

        if (isNetworkError && retryCount < 3) {
          // Schedule retry with exponential backoff
          const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
          console.log(`[usePurchaseWithBalance] Network error, retrying in ${delay}ms...`);

          setRetryCount(prev => prev + 1);

          return new Promise((resolve) => {
            retryTimeoutRef.current = setTimeout(() => {
              purchase(options).then(resolve);
            }, delay);
          });
        }

        // Permanent failure
        setError(invokeError.message || 'Purchase failed');
        setLoading(false);
        return false;
      }

      // Handle error responses
      if (data?.status === 'error') {
        console.error('[usePurchaseWithBalance] Error response:', data.error);
        setError(data.error || 'Purchase failed');
        setLoading(false);
        return false;
      }

      // Handle success
      if (data?.status === 'ok') {
        console.log('[usePurchaseWithBalance] Purchase successful!', {
          entryId: data.entry_id,
          ticketCount: data.tickets?.length,
          newBalance: data.new_balance,
          totalCost: data.total_cost
        });
        
        // Mark idempotency key as terminal
        if (reservationId) {
          idempotencyKeyManager.markTerminal(reservationId);
        }
        
        // Dispatch balance update event for other components
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('balance-updated', {
            detail: {
              newBalance: Number(data.new_balance),
              purchaseAmount: Number(data.total_cost || 0),
              tickets: data.tickets,
              competitionId: data.competition_id
            }
          }));
        }
        
        setResult(data);
        setLoading(false);
        setRetryCount(0);
        idempotencyKeyRef.current = null;
        return true;
      }
      
      // Unknown response format
      console.error('[usePurchaseWithBalance] Unknown response:', data);
      setError('Invalid response from server');
      setLoading(false);
      return false;
      
    } catch (err) {
      console.error('[usePurchaseWithBalance] Exception:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setLoading(false);
      return false;
    }
  }, [retryCount]);
  
  return {
    purchase,
    loading,
    error,
    result,
    retryCount,
    reset
  };
}

/**
 * Example usage in a component:
 * 
 * ```tsx
 * import { usePurchaseWithBalance } from '@/hooks/usePurchaseWithBalance';
 * 
 * function PurchaseButton({ 
 *   userId, 
 *   competitionId, 
 *   ticketNumbers, 
 *   ticketPrice,
 *   reservationId 
 * }) {
 *   const { purchase, loading, error, result, retryCount } = usePurchaseWithBalance();
 *   
 *   const handleClick = async () => {
 *     const success = await purchase({
 *       userId,
 *       competitionId,
 *       ticketNumbers,
 *       ticketPrice,
 *       reservationId
 *     });
 *     
 *     if (success) {
 *       alert(`Purchase complete! New balance: $${result?.new_balance}`);
 *     }
 *   };
 *   
 *   if (error) {
 *     return <div className="error">{error}</div>;
 *   }
 *   
 *   if (result) {
 *     return (
 *       <div className="success">
 *         <h3>Purchase Successful!</h3>
 *         <p>Tickets: {result.tickets.map(t => t.ticket_number).join(', ')}</p>
 *         <p>New Balance: ${result.new_balance.toFixed(2)}</p>
 *       </div>
 *     );
 *   }
 *   
 *   return (
 *     <button 
 *       onClick={handleClick}
 *       disabled={loading}
 *       className="purchase-btn"
 *     >
 *       {loading ? (
 *         <>
 *           <Spinner />
 *           {retryCount > 0 ? `Retrying (${retryCount}/3)...` : 'Processing...'}
 *         </>
 *       ) : (
 *         'Purchase with Balance'
 *       )}
 *     </button>
 *   );
 * }
 * ```
 */
