/**
 * User-Friendly Error Handler
 * 
 * Translates technical errors into clear, actionable messages for users.
 * Provides context, next steps, and automatic fixes when possible.
 * 
 * This is the user-facing layer of aggressive mode.
 */

import { databaseLogger } from './debug-console';
import { schemaManager } from './aggressive-schema-manager';
import { hasAdminAccess } from './supabase-admin';

export interface UserFriendlyError {
  title: string;
  message: string;
  actionable: boolean;
  autoFixing?: boolean;
  retryAfter?: number; // seconds
  technicalDetails?: string;
}

/**
 * Convert technical error to user-friendly message
 */
export function makeErrorFriendly(error: any, context?: string): UserFriendlyError {
  const errorStr = String(error?.message || error || 'Unknown error').toLowerCase();
  const ctx = context || 'performing this action';

  // Network/Connection errors
  if (errorStr.includes('fetch') || errorStr.includes('network') || errorStr.includes('connection')) {
    return {
      title: '🌐 Network Issue Detected',
      message: 'We\'re experiencing a temporary connection issue. Please wait 30 seconds while we investigate and try again.',
      actionable: true,
      retryAfter: 30,
      technicalDetails: String(error?.message || error),
    };
  }

  // Missing table/column - auto-fixable
  if (errorStr.includes('does not exist')) {
    if (errorStr.includes('column')) {
      const match = String(error?.message || error).match(/column\s+"?([^"\s.]+)"?\.?"?([^"\s]+)"?\s+does not exist/i);
      const columnName = match ? match[2] : 'a required field';
      
      return {
        title: '🔧 Auto-Fixing Database',
        message: `We noticed a missing field (${columnName}). Don't worry - we're adding it automatically! This will take just a moment.`,
        actionable: true,
        autoFixing: true,
        retryAfter: 3,
        technicalDetails: String(error?.message || error),
      };
    }
    
    if (errorStr.includes('table') || errorStr.includes('relation')) {
      const match = String(error?.message || error).match(/table\s+"?([^"\s]+)"?\s+does not exist/i);
      const tableName = match ? match[1] : 'a data table';
      
      return {
        title: '🔧 Auto-Fixing Database',
        message: `We're creating the ${tableName} storage. This is automatic and will complete in a few seconds. Please try again shortly.`,
        actionable: true,
        autoFixing: true,
        retryAfter: 5,
        technicalDetails: String(error?.message || error),
      };
    }
  }

  // Competition-specific errors
  if (context?.includes('competition') || context?.includes('ticket')) {
    // Not enough tickets
    if (errorStr.includes('ticket') && (errorStr.includes('available') || errorStr.includes('conflict'))) {
      return {
        title: '🎫 Oops! Tickets Taken',
        message: 'Someone else just grabbed those tickets! The competition is popular right now. Please select different numbers and try again.',
        actionable: true,
        technicalDetails: String(error?.message || error),
      };
    }

    // Competition ended
    if (errorStr.includes('end') || errorStr.includes('expired')) {
      return {
        title: '⏰ Competition Closed',
        message: 'This competition has ended. Check out our other active competitions!',
        actionable: false,
        technicalDetails: String(error?.message || error),
      };
    }

    // Competition not active
    if (errorStr.includes('not') && errorStr.includes('active')) {
      return {
        title: '🚫 Competition Not Available',
        message: 'This competition isn\'t currently accepting entries. It may be drawing winners or has been paused.',
        actionable: false,
        technicalDetails: String(error?.message || error),
      };
    }
  }

  // Balance/Payment errors
  if (context?.includes('balance') || context?.includes('payment')) {
    if (errorStr.includes('insufficient') || errorStr.includes('not enough')) {
      return {
        title: '💰 Insufficient Balance',
        message: 'You don\'t have enough balance for this purchase. Please top up your account first.',
        actionable: true,
        technicalDetails: String(error?.message || error),
      };
    }

    if (errorStr.includes('transaction') && errorStr.includes('failed')) {
      return {
        title: '💳 Payment Processing Issue',
        message: 'The payment couldn\'t be completed. Please check your wallet and try again. If the problem persists, contact support.',
        actionable: true,
        technicalDetails: String(error?.message || error),
      };
    }
  }

  // Authentication errors
  if (context?.includes('auth') || context?.includes('login') || context?.includes('signup')) {
    if (errorStr.includes('already exists') || errorStr.includes('duplicate')) {
      return {
        title: '👤 Account Already Exists',
        message: 'An account with this information already exists. Try logging in instead!',
        actionable: true,
        technicalDetails: String(error?.message || error),
      };
    }

    if (errorStr.includes('invalid') || errorStr.includes('incorrect')) {
      return {
        title: '🔐 Invalid Credentials',
        message: 'The information provided doesn\'t match our records. Please check and try again.',
        actionable: true,
        technicalDetails: String(error?.message || error),
      };
    }
  }

  // Constraint violations - auto-fixable
  if (errorStr.includes('constraint') || errorStr.includes('violates')) {
    return {
      title: '🔧 Auto-Fixing Database Rules',
      message: 'We detected an outdated database rule. We\'re updating it automatically - this will take just a moment.',
      actionable: true,
      autoFixing: true,
      retryAfter: 5,
      technicalDetails: String(error?.message || error),
    };
  }

  // Permission errors
  if (errorStr.includes('permission') || errorStr.includes('denied') || errorStr.includes('unauthorized')) {
    return {
      title: '🔒 Access Issue',
      message: 'You don\'t have permission for this action. Please make sure you\'re logged in.',
      actionable: true,
      technicalDetails: String(error?.message || error),
    };
  }

  // Server errors (500s)
  if (errorStr.includes('500') || errorStr.includes('internal server')) {
    return {
      title: '🔧 Server Processing',
      message: 'Our server is processing your request. Please wait 30 seconds and try again.',
      actionable: true,
      retryAfter: 30,
      technicalDetails: String(error?.message || error),
    };
  }

  // Generic fallback
  return {
    title: '⚠️ Something Went Wrong',
    message: `We encountered an issue while ${ctx}. Our system is investigating. Please try again in a moment.`,
    actionable: true,
    retryAfter: 10,
    technicalDetails: String(error?.message || error),
  };
}

/**
 * Check if error is auto-fixable and attempt to fix it
 */
export async function attemptAutoFix(error: any): Promise<{
  fixed: boolean;
  message?: string;
}> {
  if (!hasAdminAccess()) {
    return { fixed: false, message: 'Auto-fix not available (admin access required)' };
  }

  const errorStr = String(error?.message || error);
  
  databaseLogger.info('[UserFriendlyError] Attempting auto-fix', { error: errorStr });

  try {
    const fixed = await schemaManager.autoFixSchemaError(errorStr);
    
    if (fixed) {
      databaseLogger.info('[UserFriendlyError] Auto-fix successful');
      return { 
        fixed: true, 
        message: 'Database updated successfully! Please try your action again.' 
      };
    }
  } catch (err) {
    databaseLogger.error('[UserFriendlyError] Auto-fix failed', err);
  }

  return { fixed: false };
}

/**
 * Get specific error message for competition ticket operations
 */
export function getTicketError(
  requestedTickets: number[],
  availableCount: number,
  competitionId: string
): UserFriendlyError {
  const requestedCount = requestedTickets.length;
  
  if (availableCount === 0) {
    return {
      title: '😔 Competition Sold Out!',
      message: 'All tickets for this competition have been sold. Check out our other exciting competitions!',
      actionable: false,
    };
  }

  if (requestedCount > availableCount) {
    return {
      title: `🎫 Only ${availableCount} Ticket${availableCount !== 1 ? 's' : ''} Left!`,
      message: `Oh no! There ${availableCount === 1 ? 'is' : 'are'} only ${availableCount} ticket${availableCount !== 1 ? 's' : ''} remaining in this competition. Please select ${availableCount} or fewer tickets and try again!`,
      actionable: true,
    };
  }

  return {
    title: '🎫 Tickets Unavailable',
    message: 'Some selected tickets are no longer available. Please try selecting different numbers.',
    actionable: true,
  };
}

/**
 * Display error to user (this would be connected to your UI notification system)
 */
export function showUserError(error: UserFriendlyError): void {
  // Log to console for now - in production, this would trigger a toast/modal
  console.group(`%c${error.title}`, 'color: #ff6b6b; font-weight: bold; font-size: 14px;');
  console.log(`%c${error.message}`, 'color: #333; font-size: 12px;');
  
  if (error.autoFixing) {
    console.log(`%c🔧 Auto-fix in progress...`, 'color: #4ecdc4; font-weight: bold;');
  }
  
  if (error.retryAfter) {
    console.log(`%c⏱️ Retry in ${error.retryAfter} seconds`, 'color: #95afc0;');
  }
  
  if (error.technicalDetails) {
    console.log(`%cTechnical: ${error.technicalDetails}`, 'color: #999; font-size: 10px;');
  }
  
  console.groupEnd();

  databaseLogger.warn('[UserFriendlyError] Error shown to user', {
    title: error.title,
    message: error.message,
    autoFixing: error.autoFixing,
  });
}

export const userFriendlyErrors = {
  make: makeErrorFriendly,
  autoFix: attemptAutoFix,
  ticketError: getTicketError,
  show: showUserError,
};

export default userFriendlyErrors;
