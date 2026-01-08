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

  const errorObj = error as { message?: string; code?: string };
  const message = errorObj.message?.toLowerCase() || '';
  const code = errorObj.code?.toLowerCase() || '';

  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('connection') ||
    code === 'network_error' ||
    code === 'econnrefused'
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
 */
export function getUserFriendlyErrorMessage(statusCode?: number, originalMessage?: string): string {
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
      return 'Some tickets are no longer available. Please refresh and select different tickets.';
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

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    delayMs?: number;
    context?: string;
  } = {}
): Promise<T> {
  const { maxRetries = 3, delayMs = 1000, context = 'operation' } = options;

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

      if (isNetworkError(error)) {
        console.warn(`[Retry ${attempt}/${maxRetries}] Network error in ${context}, retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      } else {
        break;
      }
    }
  }

  throw lastError;
}