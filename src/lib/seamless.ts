/**
 * Seamless Data Operations - Main Export
 * 
 * Import seamless operations from here for easy, user-friendly database interactions.
 * 
 * Usage:
 *   import { seamlessOps } from '@/lib/seamless';
 * 
 *   // Sign up user (handles partial data automatically)
 *   const { success, userId } = await seamlessOps.signup({
 *     username: 'john_doe',
 *     email: 'john@example.com'
 *   });
 * 
 *   // Connect wallet (seamless, no Supabase errors)
 *   await seamlessOps.connectWallet(userId, walletAddress);
 * 
 *   // Top up balance
 *   await seamlessOps.topUp(userId, 100, txHash);
 * 
 *   // Purchase tickets (with smart error messages)
 *   const { success, message } = await seamlessOps.purchaseTickets(
 *     userId, 
 *     competitionId, 
 *     [1, 2, 3]
 *   );
 * 
 * All operations:
 * - Auto-fix database schema issues
 * - Show user-friendly error messages
 * - Handle partial data gracefully
 * - Work transparently in the background
 */

// Main seamless operations interface
export { seamlessOps, seamlessOps as default } from './seamless-ops';

// User-friendly error utilities
export { 
  userFriendlyErrors,
  makeErrorFriendly,
  attemptAutoFix,
  showUserError,
  type UserFriendlyError
} from './user-friendly-errors';

// Advanced operations (for special cases)
export { omnipotentData } from './omnipotent-data-service';
export { aggressiveOps } from './aggressive-ops';
export { aggressiveCRUD } from './aggressive-crud';

// Status check
export { hasAdminAccess } from './supabase-admin';
