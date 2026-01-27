/**
 * Seamless User Operations
 * 
 * Automatically handles all user operations with:
 * - Automatic schema fixes
 * - User-friendly error messages
 * - Partial data preservation
 * - Transparent background processing
 * 
 * This is the main interface for user-initiated actions.
 * All operations here "just work" - no technical errors shown to users.
 */

import { aggressiveOps } from './aggressive-ops';
import { omnipotentData } from './omnipotent-data-service';
import { userFriendlyErrors, makeErrorFriendly, attemptAutoFix, showUserError } from './user-friendly-errors';
import { databaseLogger } from './debug-console';
import { hasAdminAccess } from './supabase-admin';
import { ensureTable, ensureColumn } from './aggressive-crud';

// ============================================================================
// AUTO-INITIALIZATION
// Ensures all core tables exist when the app starts
// ============================================================================

let initialized = false;

async function ensureCoreSchema(): Promise<void> {
  if (!hasAdminAccess() || initialized) return;

  databaseLogger.info('[SeamlessOps] Ensuring core schema exists');

  try {
    // Ensure canonical_users table exists
    await ensureTable('canonical_users', [
      { name: 'id', type: 'TEXT' }, // This is the primary identifier
      { name: 'username', type: 'TEXT', nullable: true },
      { name: 'email', type: 'TEXT', nullable: true },
      { name: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
      { name: 'updated_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
    ]);

    // Ensure profiles table exists
    await ensureTable('profiles', [
      { name: 'id', type: 'UUID' },
      { name: 'wallet_address', type: 'TEXT', nullable: true },
      { name: 'email', type: 'TEXT', nullable: true },
      { name: 'username', type: 'TEXT', nullable: true },
      { name: 'avatar_url', type: 'TEXT', nullable: true },
      { name: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
      { name: 'updated_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
    ]);

    // Ensure balance tables exist
    await ensureTable('sub_account_balance', [
      { name: 'id', type: 'UUID', defaultValue: 'gen_random_uuid()' },
      { name: 'user_id', type: 'TEXT' },
      { name: 'balance', type: 'NUMERIC', defaultValue: '0' },
      { name: 'currency', type: 'TEXT', defaultValue: "'USD'" },
      { name: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
      { name: 'updated_at', type: 'TIMESTAMPTZ', defaultValue: 'now()' },
    ]);

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

    initialized = true;
    databaseLogger.info('[SeamlessOps] Core schema ready ✓');
  } catch (err) {
    databaseLogger.error('[SeamlessOps] Schema initialization failed', err);
  }
}

// Auto-run schema check when module loads
ensureCoreSchema();

// ============================================================================
// SEAMLESS USER SIGNUP
// Handles partial form data, creates canonical user immediately
// ============================================================================

export async function seamlessSignup(data: {
  username?: string;
  email?: string;
  walletAddress?: string;
  userId?: string;
}): Promise<{
  success: boolean;
  userId?: string;
  message?: string;
  error?: any;
}> {
  databaseLogger.info('[SeamlessOps] Signup initiated', { 
    hasUsername: !!data.username,
    hasEmail: !!data.email,
    hasWallet: !!data.walletAddress,
  });

  try {
    // Generate or use provided userId
    const userId = data.userId || crypto.randomUUID();

    // Step 1: Create canonical user entry immediately (even with partial data)
    // This ensures username is claimed even if user abandons the form
    const canonicalData: any = {
      id: userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (data.username) canonicalData.username = data.username;
    if (data.email) canonicalData.email = data.email;

    const { success: canonicalSuccess, error: canonicalError } = 
      await aggressiveOps.upsertUser({
        id: userId,
        ...canonicalData
      });

    if (!canonicalSuccess && canonicalError) {
      const friendlyError = makeErrorFriendly(canonicalError, 'creating your account');
      
      // Try auto-fix if possible
      if (friendlyError.autoFixing) {
        showUserError(friendlyError);
        const { fixed } = await attemptAutoFix(canonicalError);
        
        if (fixed) {
          // Retry after fix
          const retry = await aggressiveOps.upsertUser({
            id: userId,
            ...canonicalData
          });
          
          if (!retry.success) {
            showUserError(makeErrorFriendly(retry.error, 'creating your account'));
            return { success: false, error: retry.error };
          }
        }
      } else {
        showUserError(friendlyError);
        return { success: false, error: canonicalError };
      }
    }

    // Step 2: Create profile if wallet address provided
    if (data.walletAddress) {
      await aggressiveOps.upsertUser({
        id: userId,
        wallet_address: data.walletAddress,
        email: data.email,
        username: data.username,
      });
    }

    // Step 3: Initialize user balance
    await aggressiveOps.getBalance(userId); // This creates it if it doesn't exist

    databaseLogger.info('[SeamlessOps] Signup successful', { userId });
    
    return {
      success: true,
      userId,
      message: 'Welcome! Your account is ready.',
    };
  } catch (err) {
    const friendlyError = makeErrorFriendly(err, 'creating your account');
    showUserError(friendlyError);
    
    databaseLogger.error('[SeamlessOps] Signup failed', err);
    return { success: false, error: err };
  }
}

// ============================================================================
// SEAMLESS WALLET CONNECTION
// Connects wallet to existing account seamlessly
// ============================================================================

export async function seamlessConnectWallet(
  userId: string,
  walletAddress: string
): Promise<{
  success: boolean;
  message?: string;
  error?: any;
}> {
  databaseLogger.info('[SeamlessOps] Connecting wallet', { userId, wallet: walletAddress.substring(0, 10) });

  try {
    // Update both canonical_users and profiles
    const { success, error } = await aggressiveOps.upsertUser({
      id: userId,
      wallet_address: walletAddress,
      updated_at: new Date().toISOString(),
    });

    if (!success && error) {
      const friendlyError = makeErrorFriendly(error, 'connecting your wallet');
      showUserError(friendlyError);
      
      // Try auto-fix
      if (friendlyError.autoFixing) {
        const { fixed } = await attemptAutoFix(error);
        if (fixed) {
          // Retry
          const retry = await aggressiveOps.upsertUser({
            id: userId,
            wallet_address: walletAddress,
            updated_at: new Date().toISOString(),
          });
          
          if (!retry.success) {
            return { success: false, error: retry.error };
          }
          
          return {
            success: true,
            message: 'Wallet connected successfully!',
          };
        }
      }
      
      return { success: false, error };
    }

    databaseLogger.info('[SeamlessOps] Wallet connected ✓', { userId });
    
    return {
      success: true,
      message: 'Wallet connected successfully!',
    };
  } catch (err) {
    const friendlyError = makeErrorFriendly(err, 'connecting your wallet');
    showUserError(friendlyError);
    
    return { success: false, error: err };
  }
}

// ============================================================================
// SEAMLESS BALANCE TOP-UP
// Handles balance additions with full error recovery
// ============================================================================

export async function seamlessTopUp(
  userId: string,
  amount: number,
  transactionHash?: string
): Promise<{
  success: boolean;
  newBalance?: number;
  message?: string;
  error?: any;
}> {
  databaseLogger.info('[SeamlessOps] Processing top-up', { userId, amount });

  try {
    const { success, newBalance, error } = await aggressiveOps.processTopUp(
      userId,
      amount,
      transactionHash,
      { timestamp: new Date().toISOString() }
    );

    if (!success && error) {
      const friendlyError = makeErrorFriendly(error, 'adding funds to your account');
      showUserError(friendlyError);
      
      // Try auto-fix
      if (friendlyError.autoFixing) {
        const { fixed } = await attemptAutoFix(error);
        if (fixed) {
          // Retry
          const retry = await aggressiveOps.processTopUp(
            userId,
            amount,
            transactionHash,
            { timestamp: new Date().toISOString() }
          );
          
          if (!retry.success) {
            return { success: false, error: retry.error };
          }
          
          return {
            success: true,
            newBalance: retry.newBalance,
            message: `Successfully added $${amount} to your balance!`,
          };
        }
      }
      
      return { success: false, error };
    }

    return {
      success: true,
      newBalance,
      message: `Successfully added $${amount} to your balance!`,
    };
  } catch (err) {
    const friendlyError = makeErrorFriendly(err, 'adding funds to your account');
    showUserError(friendlyError);
    
    return { success: false, error: err };
  }
}

// ============================================================================
// SEAMLESS TICKET PURCHASE
// Handles competition entry with intelligent error messages
// ============================================================================

export async function seamlessPurchaseTickets(
  userId: string,
  competitionId: string,
  ticketNumbers: number[]
): Promise<{
  success: boolean;
  entryId?: string;
  message?: string;
  error?: any;
}> {
  databaseLogger.info('[SeamlessOps] Purchasing tickets', { 
    userId, 
    competitionId,
    ticketCount: ticketNumbers.length 
  });

  try {
    // Get competition details first for better error messages
    const competition = await omnipotentData.getCompetition(competitionId);
    
    if (!competition) {
      const error = {
        title: '🤔 Competition Not Found',
        message: 'We couldn\'t find this competition. It may have been removed or the link is incorrect.',
        actionable: false,
      };
      showUserError(error);
      return { success: false, error: 'Competition not found' };
    }

    // Check if competition is active
    if (competition.status !== 'active') {
      const error = {
        title: '🚫 Competition Not Active',
        message: `This competition is currently ${competition.status}. Check back later or explore our other competitions!`,
        actionable: false,
      };
      showUserError(error);
      return { success: false, error: `Competition is ${competition.status}` };
    }

    // Check ticket availability
    const unavailable = await omnipotentData.getUnavailableTickets(competitionId);
    const totalTickets = competition.total_tickets;
    const availableCount = totalTickets - unavailable.length;
    
    // Check if enough tickets available
    if (ticketNumbers.length > availableCount) {
      const error = userFriendlyErrors.ticketError(ticketNumbers, availableCount, competitionId);
      showUserError(error);
      return { success: false, error: error.message };
    }

    // Check if specific tickets are available
    const conflicting = ticketNumbers.filter(t => unavailable.includes(t));
    if (conflicting.length > 0) {
      const error = {
        title: '🎫 Tickets Already Taken',
        message: `Ticket${conflicting.length > 1 ? 's' : ''} ${conflicting.join(', ')} ${conflicting.length > 1 ? 'have' : 'has'} just been selected by someone else. Please choose different numbers!`,
        actionable: true,
      };
      showUserError(error);
      return { success: false, error: error.message };
    }

    // Calculate amount
    const amount = competition.ticket_price * ticketNumbers.length;

    // Check balance
    const { balance } = await aggressiveOps.getBalance(userId);
    if (balance === undefined || balance < amount) {
      const error = {
        title: '💰 Insufficient Balance',
        message: `You need $${amount} but only have $${balance || 0}. Please top up your account first!`,
        actionable: true,
      };
      showUserError(error);
      return { success: false, error: error.message };
    }

    // Attempt purchase
    const { success, entryId, error } = await aggressiveOps.purchaseTickets(
      userId,
      competitionId,
      ticketNumbers,
      amount
    );

    if (!success && error) {
      const friendlyError = makeErrorFriendly(error, 'purchasing tickets');
      showUserError(friendlyError);
      
      // Try auto-fix
      if (friendlyError.autoFixing) {
        const { fixed } = await attemptAutoFix(error);
        if (fixed) {
          // Retry
          const retry = await aggressiveOps.purchaseTickets(
            userId,
            competitionId,
            ticketNumbers,
            amount
          );
          
          if (!retry.success) {
            return { success: false, error: retry.error };
          }
          
          return {
            success: true,
            entryId: retry.entryId,
            message: `Success! You've entered ${competition.title} with ${ticketNumbers.length} ticket${ticketNumbers.length > 1 ? 's' : ''}!`,
          };
        }
      }
      
      return { success: false, error };
    }

    return {
      success: true,
      entryId,
      message: `Success! You've entered ${competition.title} with ${ticketNumbers.length} ticket${ticketNumbers.length > 1 ? 's' : ''}!`,
    };
  } catch (err) {
    const friendlyError = makeErrorFriendly(err, 'purchasing tickets');
    showUserError(friendlyError);
    
    return { success: false, error: err };
  }
}

// ============================================================================
// SEAMLESS DATA UPDATES
// Update user data with automatic handling
// ============================================================================

export async function seamlessUpdateProfile(
  userId: string,
  updates: {
    username?: string;
    email?: string;
    avatar_url?: string;
    [key: string]: any;
  }
): Promise<{
  success: boolean;
  message?: string;
  error?: any;
}> {
  databaseLogger.info('[SeamlessOps] Updating profile', { userId, fields: Object.keys(updates) });

  try {
    const { success, error } = await aggressiveOps.upsertUser({
      id: userId,
      ...updates,
      updated_at: new Date().toISOString(),
    });

    if (!success && error) {
      const friendlyError = makeErrorFriendly(error, 'updating your profile');
      showUserError(friendlyError);
      
      // Try auto-fix
      if (friendlyError.autoFixing) {
        const { fixed } = await attemptAutoFix(error);
        if (fixed) {
          const retry = await aggressiveOps.upsertUser({
            id: userId,
            ...updates,
            updated_at: new Date().toISOString(),
          });
          
          if (!retry.success) {
            return { success: false, error: retry.error };
          }
          
          return {
            success: true,
            message: 'Profile updated successfully!',
          };
        }
      }
      
      return { success: false, error };
    }

    return {
      success: true,
      message: 'Profile updated successfully!',
    };
  } catch (err) {
    const friendlyError = makeErrorFriendly(err, 'updating your profile');
    showUserError(friendlyError);
    
    return { success: false, error: err };
  }
}

// Export all seamless operations
export const seamlessOps = {
  signup: seamlessSignup,
  connectWallet: seamlessConnectWallet,
  topUp: seamlessTopUp,
  purchaseTickets: seamlessPurchaseTickets,
  updateProfile: seamlessUpdateProfile,
  
  // Re-export omnipotent data for convenience
  getCompetitions: () => omnipotentData.getCompetitions(),
  getCompetition: (id: string) => omnipotentData.getCompetition(id),
  getUserEntries: (userId: string) => omnipotentData.getUserEntries(userId),
  getBalance: (userId: string) => aggressiveOps.getBalance(userId),
};

export default seamlessOps;
