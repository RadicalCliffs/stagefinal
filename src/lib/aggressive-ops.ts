/**
 * Aggressive Operations - High-Level Wrappers
 * 
 * Pre-built aggressive operations for common app flows:
 * - User creation and profile management
 * - Balance operations (top-up, deduct, transactions)
 * - Payment processing
 * - Ticket purchases
 * 
 * These wrappers ensure that common operations always succeed by:
 * - Auto-creating missing tables/columns
 * - Handling constraint violations gracefully
 * - Retrying with fixes on errors
 */

import { aggressiveCRUD, ensureTable, ensureColumn } from './aggressive-crud';
import { omnipotentData } from './omnipotent-data-service';
import { databaseLogger } from './debug-console';
import { hasAdminAccess } from './supabase-admin';

// ============================================================================
// USER OPERATIONS
// ============================================================================

/**
 * Aggressively create or update a user profile
 * Ensures the profiles table and all required columns exist
 */
export async function aggressiveUpsertUser(userData: {
  id: string;
  wallet_address?: string;
  email?: string;
  username?: string;
  avatar_url?: string;
  [key: string]: any;
}): Promise<{ success: boolean; data?: any; error?: any }> {
  databaseLogger.info('[AggressiveOps] Upserting user', { userId: userData.id });

  try {
    // Ensure profiles table exists
    if (hasAdminAccess()) {
      await ensureTable('profiles', [
        { name: 'id', type: 'UUID' },
        { name: 'wallet_address', type: 'TEXT', nullable: true },
        { name: 'email', type: 'TEXT', nullable: true },
        { name: 'username', type: 'TEXT', nullable: true },
        { name: 'avatar_url', type: 'TEXT', nullable: true },
        { name: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
        { name: 'updated_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
      ]);

      // Ensure any additional columns from userData exist
      for (const key of Object.keys(userData)) {
        if (!['id', 'wallet_address', 'email', 'username', 'avatar_url', 'created_at', 'updated_at'].includes(key)) {
          await ensureColumn('profiles', key, 'TEXT', { nullable: true });
        }
      }
    }

    const { data, error } = await omnipotentData.aggressiveUpsert(
      'profiles',
      userData,
      'id'
    );

    if (error) {
      databaseLogger.error('[AggressiveOps] User upsert failed', { error, userId: userData.id });
      return { success: false, error };
    }

    databaseLogger.info('[AggressiveOps] User upserted successfully', { userId: userData.id });
    return { success: true, data };
  } catch (err) {
    databaseLogger.error('[AggressiveOps] User upsert exception', err);
    return { success: false, error: err };
  }
}

/**
 * Get user profile with aggressive mode
 */
export async function aggressiveGetUser(userId: string): Promise<{ success: boolean; data?: any; error?: any }> {
  try {
    const { data, error } = await omnipotentData.aggressiveSelect(
      'profiles',
      '*',
      { id: userId }
    );

    if (error) {
      return { success: false, error };
    }

    return { success: true, data: data && data.length > 0 ? data[0] : null };
  } catch (err) {
    return { success: false, error: err };
  }
}

// ============================================================================
// BALANCE OPERATIONS
// ============================================================================

/**
 * Aggressively get user balance
 * Creates balance record if it doesn't exist
 */
export async function aggressiveGetBalance(userId: string): Promise<{ success: boolean; balance?: number; error?: any }> {
  databaseLogger.info('[AggressiveOps] Getting balance', { userId });

  try {
    // Ensure balance table exists
    if (hasAdminAccess()) {
      await ensureTable('sub_account_balance', [
        { name: 'id', type: 'UUID', defaultValue: 'gen_random_uuid()' },
        { name: 'user_id', type: 'TEXT' },
        { name: 'balance', type: 'NUMERIC', defaultValue: '0' },
        { name: 'currency', type: 'TEXT', defaultValue: "'USD'" },
        { name: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
        { name: 'updated_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
      ]);
    }

    // Try to get existing balance
    let { data, error } = await omnipotentData.aggressiveSelect(
      'sub_account_balance',
      '*',
      { user_id: userId }
    );

    if (error && error.message?.includes('does not exist')) {
      // Table might not exist, create it and retry
      if (hasAdminAccess()) {
        await ensureTable('sub_account_balance', [
          { name: 'id', type: 'UUID', defaultValue: 'gen_random_uuid()' },
          { name: 'user_id', type: 'TEXT' },
          { name: 'balance', type: 'NUMERIC', defaultValue: '0' },
          { name: 'currency', type: 'TEXT', defaultValue: "'USD'" },
          { name: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
          { name: 'updated_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
        ]);
      }
      
      const retry = await omnipotentData.aggressiveSelect(
        'sub_account_balance',
        '*',
        { user_id: userId }
      );
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      databaseLogger.error('[AggressiveOps] Balance fetch failed', { error, userId });
      return { success: false, error };
    }

    // If no balance record exists, create one
    if (!data || data.length === 0) {
      databaseLogger.info('[AggressiveOps] Creating new balance record', { userId });
      
      const { data: newData, error: insertError } = await omnipotentData.aggressiveInsert(
        'sub_account_balance',
        {
          user_id: userId,
          balance: 0,
          currency: 'USD',
        }
      );

      if (insertError) {
        return { success: false, error: insertError };
      }

      return { success: true, balance: 0 };
    }

    const balance = Number(data[0].balance) || 0;
    return { success: true, balance };
  } catch (err) {
    databaseLogger.error('[AggressiveOps] Balance fetch exception', err);
    return { success: false, error: err };
  }
}

/**
 * Aggressively update user balance
 */
export async function aggressiveUpdateBalance(
  userId: string,
  amount: number,
  operation: 'add' | 'subtract' = 'add'
): Promise<{ success: boolean; newBalance?: number; error?: any }> {
  databaseLogger.info('[AggressiveOps] Updating balance', { userId, amount, operation });

  try {
    // Get current balance
    const { success, balance: currentBalance, error: getError } = await aggressiveGetBalance(userId);
    
    if (!success || currentBalance === undefined) {
      return { success: false, error: getError || 'Could not get current balance' };
    }

    // Calculate new balance
    const newBalance = operation === 'add' 
      ? currentBalance + amount 
      : currentBalance - amount;

    if (newBalance < 0 && operation === 'subtract') {
      return { success: false, error: 'Insufficient balance' };
    }

    // Update balance
    const { data, error } = await omnipotentData.aggressiveUpdate(
      'sub_account_balance',
      { 
        balance: newBalance,
        updated_at: new Date().toISOString(),
      },
      { user_id: userId }
    );

    if (error) {
      databaseLogger.error('[AggressiveOps] Balance update failed', { error, userId });
      return { success: false, error };
    }

    databaseLogger.info('[AggressiveOps] Balance updated successfully', { userId, newBalance });
    return { success: true, newBalance };
  } catch (err) {
    databaseLogger.error('[AggressiveOps] Balance update exception', err);
    return { success: false, error: err };
  }
}

/**
 * Aggressively record a balance transaction
 */
export async function aggressiveRecordTransaction(transaction: {
  user_id: string;
  amount: number;
  type: 'topup' | 'debit' | 'refund' | 'payment';
  description?: string;
  transaction_hash?: string;
  metadata?: any;
}): Promise<{ success: boolean; data?: any; error?: any }> {
  databaseLogger.info('[AggressiveOps] Recording transaction', { transaction });

  try {
    // Ensure transactions table exists
    if (hasAdminAccess()) {
      await ensureTable('balance_ledger', [
        { name: 'id', type: 'UUID', defaultValue: 'gen_random_uuid()' },
        { name: 'user_id', type: 'TEXT' },
        { name: 'amount', type: 'NUMERIC' },
        { name: 'type', type: 'TEXT' },
        { name: 'description', type: 'TEXT', nullable: true },
        { name: 'transaction_hash', type: 'TEXT', nullable: true },
        { name: 'metadata', type: 'JSONB', nullable: true },
        { name: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
      ]);
    }

    const { data, error } = await omnipotentData.aggressiveInsert(
      'balance_ledger',
      transaction
    );

    if (error) {
      databaseLogger.error('[AggressiveOps] Transaction recording failed', { error, transaction });
      return { success: false, error };
    }

    databaseLogger.info('[AggressiveOps] Transaction recorded successfully', { transactionId: data?.id });
    return { success: true, data };
  } catch (err) {
    databaseLogger.error('[AggressiveOps] Transaction recording exception', err);
    return { success: false, error: err };
  }
}

// ============================================================================
// PAYMENT OPERATIONS
// ============================================================================

/**
 * Aggressively process a payment
 * Handles balance deduction and transaction recording
 */
export async function aggressiveProcessPayment(
  userId: string,
  amount: number,
  description: string,
  metadata?: any
): Promise<{ success: boolean; error?: any }> {
  databaseLogger.info('[AggressiveOps] Processing payment', { userId, amount, description });

  try {
    // Deduct balance
    const { success: balanceSuccess, newBalance, error: balanceError } = 
      await aggressiveUpdateBalance(userId, amount, 'subtract');

    if (!balanceSuccess) {
      return { success: false, error: balanceError };
    }

    // Record transaction
    const { success: txSuccess, error: txError } = await aggressiveRecordTransaction({
      user_id: userId,
      amount: -amount,
      type: 'payment',
      description,
      metadata,
    });

    if (!txSuccess) {
      databaseLogger.warn('[AggressiveOps] Transaction recording failed but balance was deducted', { 
        userId, 
        amount, 
        error: txError 
      });
    }

    databaseLogger.info('[AggressiveOps] Payment processed successfully', { 
      userId, 
      amount, 
      newBalance 
    });
    
    return { success: true };
  } catch (err) {
    databaseLogger.error('[AggressiveOps] Payment processing exception', err);
    return { success: false, error: err };
  }
}

/**
 * Aggressively process a top-up
 * Adds to balance and records transaction
 */
export async function aggressiveProcessTopUp(
  userId: string,
  amount: number,
  transactionHash?: string,
  metadata?: any
): Promise<{ success: boolean; newBalance?: number; error?: any }> {
  databaseLogger.info('[AggressiveOps] Processing top-up', { userId, amount, transactionHash });

  try {
    // Add to balance
    const { success: balanceSuccess, newBalance, error: balanceError } = 
      await aggressiveUpdateBalance(userId, amount, 'add');

    if (!balanceSuccess) {
      return { success: false, error: balanceError };
    }

    // Record transaction
    const { success: txSuccess, error: txError } = await aggressiveRecordTransaction({
      user_id: userId,
      amount: amount,
      type: 'topup',
      description: 'Balance top-up',
      transaction_hash: transactionHash,
      metadata,
    });

    if (!txSuccess) {
      databaseLogger.warn('[AggressiveOps] Transaction recording failed but balance was added', { 
        userId, 
        amount, 
        error: txError 
      });
    }

    databaseLogger.info('[AggressiveOps] Top-up processed successfully', { 
      userId, 
      amount, 
      newBalance 
    });
    
    return { success: true, newBalance };
  } catch (err) {
    databaseLogger.error('[AggressiveOps] Top-up processing exception', err);
    return { success: false, error: err };
  }
}

// ============================================================================
// TICKET OPERATIONS
// ============================================================================

/**
 * Aggressively purchase tickets
 * Handles reservation confirmation and balance deduction
 */
export async function aggressivePurchaseTickets(
  userId: string,
  competitionId: string,
  ticketNumbers: number[],
  amount: number
): Promise<{ success: boolean; entryId?: string; error?: any }> {
  databaseLogger.info('[AggressiveOps] Purchasing tickets', { 
    userId, 
    competitionId, 
    ticketCount: ticketNumbers.length,
    amount 
  });

  try {
    // Ensure tables exist
    if (hasAdminAccess()) {
      await ensureTable('v_joincompetition_active', [
        { name: 'uid', type: 'UUID', defaultValue: 'gen_random_uuid()' },
        { name: 'privy_user_id', type: 'TEXT' },
        { name: 'competitionid', type: 'UUID' },
        { name: 'ticketnumbers', type: 'TEXT' },
        { name: 'numberoftickets', type: 'INTEGER' },
        { name: 'amountspent', type: 'NUMERIC' },
        { name: 'purchasedate', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
        { name: 'transactionhash', type: 'TEXT', nullable: true },
      ]);
    }

    // Process payment first
    const { success: paymentSuccess, error: paymentError } = await aggressiveProcessPayment(
      userId,
      amount,
      `Ticket purchase for competition ${competitionId}`,
      { competitionId, ticketNumbers }
    );

    if (!paymentSuccess) {
      return { success: false, error: paymentError };
    }

    // Create entry
    const entryData = {
      privy_user_id: userId,
      competitionid: competitionId,
      ticketnumbers: ticketNumbers.join(','),
      numberoftickets: ticketNumbers.length,
      amountspent: amount,
      purchasedate: new Date().toISOString(),
    };

    const { data, error } = await omnipotentData.aggressiveInsert(
      'v_joincompetition_active',
      entryData
    );

    if (error) {
      databaseLogger.error('[AggressiveOps] Ticket purchase failed', { error, userId, competitionId });
      return { success: false, error };
    }

    databaseLogger.info('[AggressiveOps] Tickets purchased successfully', { 
      userId, 
      competitionId,
      entryId: data?.uid 
    });
    
    return { success: true, entryId: data?.uid };
  } catch (err) {
    databaseLogger.error('[AggressiveOps] Ticket purchase exception', err);
    return { success: false, error: err };
  }
}

// Export all operations
export const aggressiveOps = {
  // User operations
  upsertUser: aggressiveUpsertUser,
  getUser: aggressiveGetUser,
  
  // Balance operations
  getBalance: aggressiveGetBalance,
  updateBalance: aggressiveUpdateBalance,
  recordTransaction: aggressiveRecordTransaction,
  
  // Payment operations
  processPayment: aggressiveProcessPayment,
  processTopUp: aggressiveProcessTopUp,
  
  // Ticket operations
  purchaseTickets: aggressivePurchaseTickets,
};

export default aggressiveOps;
