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
 * The RPC can return either:
 * - An array: [{ canonical_user_id, available_balance, pending_balance, total_balance }]
 * - An object: { success, balance, bonus_balance, total_balance }
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

  // Handle ARRAY response (new RPC format returns rows)
  if (Array.isArray(rpcBalance)) {
    if (rpcBalance.length === 0) {
      return {
        success: false,
        balance: 0,
        bonus_balance: 0,
        total_balance: 0
      };
    }
    // Take the first row - RPC returns available_balance field
    const row = rpcBalance[0] as Record<string, unknown>;
    const availableBalance = Number(row.available_balance ?? row.balance) || 0;
    return {
      success: true,
      balance: availableBalance,
      bonus_balance: Number(row.bonus_balance) || 0,
      total_balance: Number(row.total_balance) || availableBalance
    };
  }

  // Handle JSONB object response (expected format)
  if (typeof rpcBalance === 'object') {
    const data = rpcBalance as Record<string, unknown>;
    // Support both 'balance' and 'available_balance' field names
    const balance = Number(data.available_balance ?? data.balance) || 0;
    return {
      success: data.success !== false,
      balance: balance,
      bonus_balance: Number(data.bonus_balance) || 0,
      total_balance: Number(data.total_balance) || balance
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
