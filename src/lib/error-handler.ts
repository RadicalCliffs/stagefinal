export class DatabaseError extends Error {
  originalError: unknown;
  statusCode?: number;

  constructor(message: string, originalError: unknown = null, statusCode?: number) {
    super(message);
    this.name = 'DatabaseError';
    this.originalError = originalError;
    this.statusCode = statusCode;
  }
}

export class NetworkError extends Error {
  originalError: unknown;
  statusCode?: number;

  constructor(message: string, originalError: unknown = null, statusCode?: number) {
    super(message);
    this.name = 'NetworkError';
    this.originalError = originalError;
    this.statusCode = statusCode;
  }
}

export class SupabaseFunctionError extends Error {
  statusCode?: number;
  originalError: unknown;

  constructor(message: string, statusCode?: number, originalError: unknown = null) {
    super(message);
    this.name = 'SupabaseFunctionError';
    this.statusCode = statusCode;
    this.originalError = originalError;
  }
}

export function handleDatabaseError(error: unknown, context: string): void {
  console.error(`[Database Error - ${context}]:`, error);

  if (error && typeof error === 'object' && 'message' in error) {
    console.error(`Error message: ${(error as Error).message}`);
  }
}

export function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const errorObj = error as { message?: string; code?: string; name?: string; status?: number };
  const message = errorObj.message?.toLowerCase() || '';
  const code = errorObj.code?.toLowerCase() || '';
  const name = errorObj.name?.toLowerCase() || '';
  const status = errorObj.status;

  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('connection') ||
    message.includes('failed to send a request') ||
    message.includes('edge function') ||
    message.includes('503') ||
    message.includes('service unavailable') ||
    name === 'functionsfetcherror' ||
    name === 'typeerror' && message.includes('fetch') ||
    code === 'network_error' ||
    code === 'econnrefused' ||
    status === 503
  );
}

export function getErrorMessage(error: unknown): string {
  if (!error) return 'An unknown error occurred';

  if (typeof error === 'string') return error;

  if (error instanceof Error) return error.message;

  if (typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }

  return 'An unexpected error occurred';
}

/**
 * Parse Supabase function invocation errors to extract HTTP status codes and messages
 */
export function parseSupabaseFunctionError(error: unknown): { statusCode?: number; message: string } {
  // Handle direct error objects from Supabase client
  if (error && typeof error === 'object') {
    const errorObj = error as any;
    
    // Check for status code in error object
    if (errorObj.statusCode || errorObj.status) {
      const statusCode = errorObj.statusCode || errorObj.status;
      const message = errorObj.message || errorObj.error?.message || 'Function invocation failed';
      
      return { statusCode, message };
    }
    
    // Check for context body parsing errors
    if (errorObj.message?.includes('Failed to fetch') || errorObj.message?.includes('Network error')) {
      return { statusCode: undefined, message: 'Network connection failed. Please check your internet connection.' };
    }
  }

  // Handle generic errors
  const message = getErrorMessage(error);
  
  // Try to extract status code from message (fallback)
  const statusMatch = message.match(/status (\d{3})/i);
  if (statusMatch) {
    return { statusCode: parseInt(statusMatch[1]), message };
  }

  return { statusCode: undefined, message };
}

/**
 * Get user-friendly error message based on HTTP status code
 *
 * Race condition handling: These messages are designed to guide users
 * when the RPC returns availability errors. Never rely on client-side
 * checks - always trust the server's response for consistency.
 */
/**
 * Enhanced payment error messages with specific guidance for common issues
 * These messages help users understand what went wrong and how to fix it
 */
export interface PaymentErrorInfo {
  message: string;
  guidance?: string;
  category: 'wallet' | 'balance' | 'network' | 'availability' | 'auth' | 'server' | 'unknown';
  retryable: boolean;
}

export function getPaymentErrorInfo(error: unknown, originalMessage?: string): PaymentErrorInfo {
  const errorStr = originalMessage || getErrorMessage(error);
  const lowerMessage = errorStr.toLowerCase();

  // Wallet connection issues
  if (lowerMessage.includes('wallet not connected') || lowerMessage.includes('no wallet')) {
    return {
      message: 'Wallet not connected',
      guidance: 'Please connect your wallet using the "Connect" button in the header, then try again.',
      category: 'wallet',
      retryable: true
    };
  }

  if (lowerMessage.includes('rejected') || lowerMessage.includes('denied') || lowerMessage.includes('user rejected')) {
    return {
      message: 'Transaction was rejected',
      guidance: 'You declined the transaction in your wallet. Click the payment button again if you\'d like to retry.',
      category: 'wallet',
      retryable: true
    };
  }

  // Balance issues
  if (lowerMessage.includes('insufficient') && (lowerMessage.includes('balance') || lowerMessage.includes('funds') || lowerMessage.includes('usdc'))) {
    return {
      message: 'Insufficient balance',
      guidance: 'Your wallet doesn\'t have enough USDC. Top up your balance or use a different payment method.',
      category: 'balance',
      retryable: true
    };
  }

  // Network issues
  if (lowerMessage.includes('network') || lowerMessage.includes('connection') || lowerMessage.includes('failed to fetch') || lowerMessage.includes('timeout')) {
    return {
      message: 'Network connection issue',
      guidance: 'Please check your internet connection and try again. If the problem persists, refresh the page.',
      category: 'network',
      retryable: true
    };
  }

  // Ticket availability issues
  if (lowerMessage.includes('insufficient') && lowerMessage.includes('availab')) {
    return {
      message: 'Not enough tickets available',
      guidance: 'The competition is filling up fast. Try selecting fewer tickets or choose different ticket numbers.',
      category: 'availability',
      retryable: true
    };
  }

  if (lowerMessage.includes('no longer available') || lowerMessage.includes('not available') || lowerMessage.includes('already taken')) {
    return {
      message: 'Tickets no longer available',
      guidance: 'Someone else just purchased those tickets. Please refresh and select different numbers.',
      category: 'availability',
      retryable: true
    };
  }

  if (lowerMessage.includes('sold out') || lowerMessage.includes('soldout')) {
    return {
      message: 'Competition sold out',
      guidance: 'This competition has no more tickets available. Browse other competitions to find your next win!',
      category: 'availability',
      retryable: false
    };
  }

  // Server errors
  if (lowerMessage.includes('server error') || lowerMessage.includes('500') || lowerMessage.includes('503')) {
    return {
      message: 'Server error',
      guidance: 'Our servers are experiencing issues. Please wait a moment and try again.',
      category: 'server',
      retryable: true
    };
  }

  // Default
  return {
    message: errorStr || 'Payment failed',
    guidance: 'Something went wrong. Please try again or contact support if the issue persists.',
    category: 'unknown',
    retryable: true
  };
}

export function getUserFriendlyErrorMessage(statusCode?: number, originalMessage?: string): string {
  // Check for specific availability-related error messages first
  const lowerMessage = originalMessage?.toLowerCase() || '';

  // Handle "insufficient availability" errors with friendly messaging
  if (lowerMessage.includes('insufficient') && lowerMessage.includes('availab')) {
    return 'Not enough tickets available. The competition may be filling up fast - please select fewer tickets or try different ones.';
  }

  if (lowerMessage.includes('no longer available') || lowerMessage.includes('not available')) {
    return 'Some of your selected tickets are no longer available. Please refresh and select different tickets.';
  }

  if (lowerMessage.includes('sold out') || lowerMessage.includes('soldout')) {
    return 'This competition is sold out. Check back later or browse other competitions.';
  }

  // Handle wallet-specific errors
  if (lowerMessage.includes('rejected') || lowerMessage.includes('denied') || lowerMessage.includes('user rejected')) {
    return 'Transaction was rejected in your wallet. Please try again.';
  }

  if (lowerMessage.includes('insufficient') && (lowerMessage.includes('balance') || lowerMessage.includes('funds'))) {
    return 'Insufficient USDC balance. Please top up your wallet or use a different payment method.';
  }

  if (lowerMessage.includes('wallet not connected') || lowerMessage.includes('no wallet')) {
    return 'Wallet not connected. Please connect your wallet and try again.';
  }

  switch (statusCode) {
    case 400:
      return 'Invalid request. Please check your selection and try again.';
    case 401:
      return 'Authentication required. Please log in and try again.';
    case 403:
      return 'Access denied. Please check your permissions.';
    case 404:
      return 'Resource not found. Please refresh the page and try again.';
    case 409:
      // 409 Conflict specifically for ticket availability race conditions
      return 'Some tickets are no longer available. Please refresh and select different tickets.';
    case 410:
      // 410 Gone - tickets were available but are now taken
      return 'The selected tickets have just been purchased by another user. Please select different tickets.';
    case 422:
      return 'Unable to process your request. Please verify your information.';
    case 429:
      return 'Too many requests. Please wait a moment and try again.';
    case 500:
      return 'Server error occurred. Please try again in a few moments.';
    case 502:
      return 'Service temporarily unavailable. Please try again later.';
    case 503:
      return 'Service temporarily unavailable. Please try again later.';
    default:
      // Use original message if it's user-friendly, otherwise provide generic message
      if (originalMessage && !originalMessage.includes('Edge Function') && !originalMessage.includes('non-2xx')) {
        return originalMessage;
      }
      return 'An unexpected error occurred. Please try again.';
  }
}

/**
 * Check if an error response indicates the operation is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const errorObj = error as Record<string, unknown>;

  // Check for explicit retryable flag from our API
  if (errorObj.retryable === true) return true;

  // Network errors are usually retryable
  if (isNetworkError(error)) return true;

  // 5xx errors are usually retryable
  const statusCode = errorObj.statusCode || errorObj.status || errorObj.errorCode;
  if (typeof statusCode === 'number' && statusCode >= 500 && statusCode < 600) return true;

  // 409 Conflict for ticket reservation is retryable (user should pick different tickets)
  if (statusCode === 409) return true;

  return false;
}

/**
 * Parse reservation-specific error responses for better handling
 * Note: For Supabase SDK v2, the error.context is a Response object.
 * Use parseReservationErrorAsync for full body parsing when possible.
 */
export function parseReservationError(error: unknown): {
  statusCode?: number;
  message: string;
  unavailableTickets?: number[];
  retryable: boolean;
} {
  const defaultResult = {
    message: 'Failed to reserve tickets. Please try again.',
    retryable: true
  };

  if (!error || typeof error !== 'object') {
    return defaultResult;
  }

  const errorObj = error as Record<string, unknown>;

  // Try to get the response data from Supabase function error
  let responseData: Record<string, unknown> | null = null;
  let statusCode: number | undefined;

  // FunctionsHttpError from Supabase SDK v2 - context is a Response object
  if (errorObj.context && typeof errorObj.context === 'object') {
    const context = errorObj.context as Record<string, unknown>;

    // Get status code from Response object
    if (typeof context.status === 'number') {
      statusCode = context.status;
    }

    // Try to access body if available (some implementations cache it)
    if (context.body) {
      try {
        responseData = typeof context.body === 'string'
          ? JSON.parse(context.body)
          : context.body as Record<string, unknown>;
      } catch {
        // Failed to parse body
      }
    }

    // Check for _bodyText (internal property in some implementations)
    if (!responseData && typeof (context as any)._bodyText === 'string') {
      try {
        responseData = JSON.parse((context as any)._bodyText);
      } catch {
        // Failed to parse
      }
    }
  }

  // Check error name for FunctionsHttpError
  if (errorObj.name === 'FunctionsHttpError' && !statusCode) {
    // Try to extract status from error message like "Edge Function returned a non-2xx status code"
    const message = String(errorObj.message || '');
    // Supabase FunctionsHttpError stores status in context.status
    // Default to 409 for reservation conflicts if we can't determine
    statusCode = 409;
  }

  // Try to extract from the error's own properties
  if (!responseData) {
    if (errorObj.error && typeof errorObj.error === 'object') {
      responseData = errorObj.error as Record<string, unknown>;
    } else if (errorObj.data && typeof errorObj.data === 'object') {
      responseData = errorObj.data as Record<string, unknown>;
    }
  }

  // Direct error response data - last resort
  if (!responseData && (errorObj.error || errorObj.message)) {
    responseData = errorObj as Record<string, unknown>;
  }

  // Extract status code from response data if not found yet
  if (!statusCode && responseData) {
    statusCode = (responseData.errorCode || responseData.statusCode) as number | undefined;
  }

  // Fallback status from error object
  if (!statusCode) {
    statusCode = errorObj.status as number | undefined;
  }

  const message = responseData
    ? (responseData.error || responseData.message || defaultResult.message) as string
    : defaultResult.message;
  const unavailableTickets = responseData?.unavailableTickets as number[] | undefined;
  const retryable = responseData?.retryable === true || isRetryableError({ statusCode });

  return {
    statusCode,
    message: getUserFriendlyErrorMessage(statusCode, message),
    unavailableTickets,
    retryable
  };
}

/**
 * Async version of parseReservationError that can read the Response body
 * Use this when you need to extract unavailableTickets from a FunctionsHttpError
 */
export async function parseReservationErrorAsync(error: unknown): Promise<{
  statusCode?: number;
  message: string;
  unavailableTickets?: number[];
  retryable: boolean;
}> {
  const defaultResult = {
    message: 'Failed to reserve tickets. Please try again.',
    retryable: true
  };

  if (!error || typeof error !== 'object') {
    return defaultResult;
  }

  const errorObj = error as Record<string, unknown>;
  let responseData: Record<string, unknown> | null = null;
  let statusCode: number | undefined;

  // FunctionsHttpError from Supabase SDK v2 - context is a Response object
  if (errorObj.context && typeof errorObj.context === 'object') {
    const context = errorObj.context as any;

    // Get status code from Response object
    if (typeof context.status === 'number') {
      statusCode = context.status;
    }

    // Try to read body using .json() method if available (Response object)
    if (typeof context.json === 'function' && !context.bodyUsed) {
      try {
        responseData = await context.json();
      } catch {
        // Body already consumed or not JSON
      }
    }

    // Fallback to body property
    if (!responseData && context.body) {
      try {
        responseData = typeof context.body === 'string'
          ? JSON.parse(context.body)
          : context.body as Record<string, unknown>;
      } catch {
        // Failed to parse body
      }
    }
  }

  // If we still don't have response data, fall back to sync parsing
  if (!responseData) {
    const syncResult = parseReservationError(error);
    return syncResult;
  }

  // Extract status code from response data if not found yet
  if (!statusCode && responseData) {
    statusCode = (responseData.errorCode || responseData.statusCode) as number | undefined;
  }

  const message = (responseData.error || responseData.message || defaultResult.message) as string;
  const unavailableTickets = responseData.unavailableTickets as number[] | undefined;
  
  // For HTTP 409 with unavailableTickets, this is NOT retryable automatically
  // The user must reselect tickets manually
  const isConflictWithUnavailable = statusCode === 409 && unavailableTickets && unavailableTickets.length > 0;
  const retryable = isConflictWithUnavailable ? false : (responseData.retryable === true || isRetryableError({ statusCode }));

  // Create specific message for 409 conflicts with unavailable tickets
  let finalMessage = message;
  if (statusCode === 409 && unavailableTickets && unavailableTickets.length > 0) {
    finalMessage = `Tickets ${unavailableTickets.join(', ')} are no longer available. Please select different tickets.`;
  } else {
    finalMessage = getUserFriendlyErrorMessage(statusCode, message);
  }

  return {
    statusCode,
    message: finalMessage,
    unavailableTickets,
    retryable
  };
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    delayMs?: number;
    context?: string;
    shouldRetry?: (error: unknown) => boolean;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    delayMs = 1000,
    context = 'operation',
    shouldRetry = isRetryableError
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries) {
        handleDatabaseError(error, `${context} (final attempt ${attempt}/${maxRetries})`);
        break;
      }

      if (shouldRetry(error)) {
        console.warn(`[Retry ${attempt}/${maxRetries}] Retryable error in ${context}, retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      } else {
        // Non-retryable error, stop immediately
        handleDatabaseError(error, `${context} (non-retryable error on attempt ${attempt})`);
        break;
      }
    }
  }

  throw lastError;
}