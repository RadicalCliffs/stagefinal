/**
 * Balance Parser Utility
 * 
 * Provides consistent parsing for get_user_balance RPC responses.
 * The RPC returns JSONB: { success: boolean, balance: number, bonus_balance: number, total_balance: number }
 */

export interface BalanceRpcResponse {
  success?: boolean;
  balance?: number;
  bonus_balance?: number;
  total_balance?: number;
}

/**
 * Parse get_user_balance RPC response
 * 
 * Handles both JSONB object response and edge cases
 * 
 * @param rpcBalance - Raw response from get_user_balance RPC
 * @returns Parsed balance data with defaults
 */
export function parseBalanceResponse(rpcBalance: unknown): BalanceRpcResponse {
  // Handle null/undefined
  if (rpcBalance == null) {
    return {
      success: false,
      balance: 0,
      bonus_balance: 0,
      total_balance: 0
    };
  }

  // Handle JSONB object response (expected format)
  if (typeof rpcBalance === 'object') {
    const data = rpcBalance as BalanceRpcResponse;
    return {
      success: data.success ?? false,
      balance: Number(data.balance) || 0,
      bonus_balance: Number(data.bonus_balance) || 0,
      total_balance: Number(data.total_balance) || 0
    };
  }

  // Handle unexpected numeric response (legacy compatibility)
  if (typeof rpcBalance === 'number') {
    return {
      success: true,
      balance: rpcBalance,
      bonus_balance: 0,
      total_balance: rpcBalance
    };
  }

  // Fallback for any other type
  return {
    success: false,
    balance: 0,
    bonus_balance: 0,
    total_balance: 0
  };
}
