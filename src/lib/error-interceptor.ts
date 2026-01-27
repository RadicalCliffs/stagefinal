/**
 * Global Error Interceptor
 * 
 * Intercepts all Supabase errors and automatically fixes schema issues.
 * This is a "nuclear option" that catches errors at the global level.
 * 
 * Usage: Import this file early in your app to enable global interception.
 */

import { schemaManager } from './aggressive-schema-manager';
import { hasAdminAccess } from './supabase-admin';
import { databaseLogger } from './debug-console';

let errorInterceptorEnabled = true;

/**
 * Enable or disable global error interception
 */
export function setErrorInterceptorEnabled(enabled: boolean): void {
  errorInterceptorEnabled = enabled;
  databaseLogger.info('[ErrorInterceptor] Status changed', { enabled });
}

/**
 * Check if error is a schema-related error that can be auto-fixed
 */
function isFixableSchemaError(error: any): boolean {
  if (!error) return false;
  
  const message = error.message || String(error);
  const lowerMsg = message.toLowerCase();
  
  return (
    lowerMsg.includes('column') && lowerMsg.includes('does not exist') ||
    lowerMsg.includes('table') && lowerMsg.includes('does not exist') ||
    lowerMsg.includes('relation') && lowerMsg.includes('does not exist') ||
    lowerMsg.includes('constraint') && lowerMsg.includes('violates') ||
    lowerMsg.includes('duplicate key value') ||
    lowerMsg.includes('unique constraint')
  );
}

/**
 * Intercept and handle Supabase errors
 */
export async function interceptError(error: any, operation?: () => Promise<any>): Promise<{
  handled: boolean;
  fixed: boolean;
  result?: any;
}> {
  if (!errorInterceptorEnabled || !hasAdminAccess()) {
    return { handled: false, fixed: false };
  }

  if (!isFixableSchemaError(error)) {
    return { handled: false, fixed: false };
  }

  const message = error.message || String(error);
  
  databaseLogger.warn('[ErrorInterceptor] Caught fixable error', { error: message });

  try {
    // Attempt to auto-fix the schema issue
    const fixed = await schemaManager.autoFixSchemaError(message);
    
    if (!fixed) {
      databaseLogger.warn('[ErrorInterceptor] Could not auto-fix error', { error: message });
      return { handled: true, fixed: false };
    }

    databaseLogger.info('[ErrorInterceptor] Successfully fixed schema error', { error: message });

    // If an operation was provided, retry it
    if (operation) {
      try {
        const result = await operation();
        databaseLogger.info('[ErrorInterceptor] Operation succeeded after fix');
        return { handled: true, fixed: true, result };
      } catch (retryError) {
        databaseLogger.error('[ErrorInterceptor] Operation failed after fix', retryError);
        return { handled: true, fixed: true };
      }
    }

    return { handled: true, fixed: true };
  } catch (err) {
    databaseLogger.error('[ErrorInterceptor] Error during interception', err);
    return { handled: true, fixed: false };
  }
}

/**
 * Wrap a Supabase operation with error interception
 */
export async function withErrorInterception<T>(
  operation: () => Promise<{ data: T | null; error: any }>
): Promise<{ data: T | null; error: any }> {
  try {
    const result = await operation();
    
    if (!result.error) {
      return result;
    }

    // Error occurred - try to intercept and fix
    const interception = await interceptError(result.error, operation);
    
    if (interception.handled && interception.fixed && interception.result) {
      return interception.result;
    }

    // Return original error if not fixed
    return result;
  } catch (err) {
    // Handle exceptions
    const interception = await interceptError(err, operation);
    
    if (interception.handled && interception.fixed && interception.result) {
      return interception.result;
    }

    return { data: null, error: err };
  }
}

/**
 * Console error handler - catches console.error calls related to Supabase
 */
const originalConsoleError = console.error;
let consoleInterceptionEnabled = false;

export function enableConsoleInterception(): void {
  if (consoleInterceptionEnabled) return;
  
  console.error = function(...args: any[]) {
    // Check if this is a Supabase error
    const errorStr = args.join(' ').toLowerCase();
    const isSupabaseError = 
      errorStr.includes('supabase') || 
      errorStr.includes('postgrest') ||
      errorStr.includes('does not exist') ||
      errorStr.includes('constraint');

    if (isSupabaseError && errorInterceptorEnabled && hasAdminAccess()) {
      // Try to extract error and fix it
      const errorMsg = args[0];
      if (typeof errorMsg === 'string' || (errorMsg && errorMsg.message)) {
        const msg = typeof errorMsg === 'string' ? errorMsg : errorMsg.message;
        
        // Don't await - handle async in background
        interceptError({ message: msg }).then(result => {
          if (result.fixed) {
            console.log('[ErrorInterceptor] Auto-fixed error from console:', msg);
          }
        });
      }
    }

    // Call original console.error
    originalConsoleError.apply(console, args);
  };

  consoleInterceptionEnabled = true;
  databaseLogger.info('[ErrorInterceptor] Console interception enabled');
}

export function disableConsoleInterception(): void {
  if (!consoleInterceptionEnabled) return;
  
  console.error = originalConsoleError;
  consoleInterceptionEnabled = false;
  databaseLogger.info('[ErrorInterceptor] Console interception disabled');
}

// Auto-enable console interception if admin access is available
if (hasAdminAccess()) {
  enableConsoleInterception();
  databaseLogger.info('[ErrorInterceptor] ✓ Global error interception active');
}

export const errorInterceptor = {
  setEnabled: setErrorInterceptorEnabled,
  interceptError,
  withErrorInterception,
  enableConsoleInterception,
  disableConsoleInterception,
  isFixableSchemaError,
};

export default errorInterceptor;
