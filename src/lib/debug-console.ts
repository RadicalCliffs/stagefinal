/**
 * Comprehensive Debug Console Utility
 *
 * Provides detailed debugging for rate limiting, RPC errors, Edge Function failures,
 * and request tracking. Designed to help diagnose:
 * - Rate limit errors (-32016) from RPC endpoints
 * - Supabase RPC function failures (404, network errors)
 * - Edge Function invocation errors
 * - Request timing and performance issues
 *
 * COMPREHENSIVE ERROR MONITORING v2.0
 * Added features:
 * - Global error capture for unhandled errors
 * - API response monitoring
 * - Performance timing for all operations
 * - Detailed error context with stack traces
 * - Error aggregation and reporting
 */

// Debug configuration - can be enabled/disabled via localStorage
const DEBUG_KEY = 'prize_debug_enabled';
const DEBUG_VERBOSE_KEY = 'prize_debug_verbose';
const ERROR_LOG_KEY = 'prize_error_log';

// Always enable debug mode by default for comprehensive visibility
let _debugAlwaysEnabled = true;

export function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return true; // Always log on server
  // Return true if always enabled, or if localStorage says so
  return _debugAlwaysEnabled || localStorage.getItem(DEBUG_KEY) === 'true';
}

export function isVerboseDebugEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return _debugAlwaysEnabled || localStorage.getItem(DEBUG_VERBOSE_KEY) === 'true';
}

export function enableDebug(verbose = false): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DEBUG_KEY, 'true');
  if (verbose) {
    localStorage.setItem(DEBUG_VERBOSE_KEY, 'true');
  }
  _debugAlwaysEnabled = true;
  console.log('%c[Debug] Debug mode enabled' + (verbose ? ' (verbose)' : ''), 'color: #00ff00; font-weight: bold');
}

export function disableDebug(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(DEBUG_KEY);
  localStorage.removeItem(DEBUG_VERBOSE_KEY);
  _debugAlwaysEnabled = false;
  console.log('%c[Debug] Debug mode disabled', 'color: #ff6600; font-weight: bold');
}

// Request tracking for rate limit analysis
interface RequestRecord {
  timestamp: number;
  endpoint: string;
  method: string;
  success: boolean;
  error?: string;
  errorCode?: number | string;
  duration?: number;
}

class RequestTracker {
  private requests: RequestRecord[] = [];
  private maxRecords = 100;
  private rateLimitHits: Map<string, number[]> = new Map();

  addRequest(record: RequestRecord): void {
    this.requests.push(record);
    if (this.requests.length > this.maxRecords) {
      this.requests.shift();
    }

    // Track rate limit hits by endpoint
    if (record.errorCode === -32016 || record.error?.includes('rate limit')) {
      const hits = this.rateLimitHits.get(record.endpoint) || [];
      hits.push(record.timestamp);
      // Keep only hits from last 60 seconds
      const cutoff = Date.now() - 60000;
      this.rateLimitHits.set(record.endpoint, hits.filter(t => t > cutoff));
    }
  }

  getRecentRequests(limit = 20): RequestRecord[] {
    return this.requests.slice(-limit);
  }

  getRateLimitStats(): { endpoint: string; hitsLast60s: number; lastHit: number }[] {
    const stats: { endpoint: string; hitsLast60s: number; lastHit: number }[] = [];
    const cutoff = Date.now() - 60000;

    this.rateLimitHits.forEach((hits, endpoint) => {
      const recentHits = hits.filter(t => t > cutoff);
      if (recentHits.length > 0) {
        stats.push({
          endpoint,
          hitsLast60s: recentHits.length,
          lastHit: Math.max(...recentHits)
        });
      }
    });

    return stats.sort((a, b) => b.hitsLast60s - a.hitsLast60s);
  }

  getErrorSummary(): { errorCode: string; count: number; lastOccurrence: number }[] {
    const errorCounts = new Map<string, { count: number; lastOccurrence: number }>();

    this.requests.forEach(req => {
      if (!req.success && req.errorCode) {
        const key = String(req.errorCode);
        const existing = errorCounts.get(key) || { count: 0, lastOccurrence: 0 };
        errorCounts.set(key, {
          count: existing.count + 1,
          lastOccurrence: Math.max(existing.lastOccurrence, req.timestamp)
        });
      }
    });

    return Array.from(errorCounts.entries())
      .map(([errorCode, data]) => ({ errorCode, ...data }))
      .sort((a, b) => b.count - a.count);
  }

  clear(): void {
    this.requests = [];
    this.rateLimitHits.clear();
  }
}

// Global request tracker instance
export const requestTracker = new RequestTracker();

// Styled console output helpers
const styles = {
  header: 'color: #00bfff; font-weight: bold; font-size: 14px',
  success: 'color: #00ff00',
  warning: 'color: #ffcc00',
  error: 'color: #ff3333; font-weight: bold',
  info: 'color: #00bfff',
  dim: 'color: #888888',
  highlight: 'background: #333; color: #fff; padding: 2px 6px; border-radius: 3px',
  rateLimitError: 'color: #ff6600; font-weight: bold; background: #442200; padding: 2px 6px; border-radius: 3px',
  networkError: 'color: #ff3333; font-weight: bold; background: #330000; padding: 2px 6px; border-radius: 3px',
  rpcError: 'color: #ff9900; background: #332200; padding: 2px 6px; border-radius: 3px',
};

// Log level enum
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
} as const;

export { LogLevel };
export type LogLevelValue = typeof LogLevel[keyof typeof LogLevel];

// Current log level (can be adjusted)
let currentLogLevel: LogLevelValue = LogLevel.DEBUG;

export function setLogLevel(level: LogLevelValue): void {
  currentLogLevel = level;
}

// Core logging function with module prefix
function log(
  level: LogLevelValue,
  module: string,
  message: string,
  data?: unknown,
  style?: string
): void {
  if (level < currentLogLevel) return;

  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  const prefix = `[${timestamp}][${module}]`;
  const logStyle = style || (level === LogLevel.ERROR ? styles.error :
                            level === LogLevel.WARN ? styles.warning : styles.info);

  if (data !== undefined) {
    console.log(`%c${prefix} ${message}`, logStyle, data);
  } else {
    console.log(`%c${prefix} ${message}`, logStyle);
  }
}

// Debug logger class for specific modules
export class DebugLogger {
  private module: string;
  private enabled: boolean;

  constructor(module: string) {
    this.module = module;
    this.enabled = true;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  debug(message: string, data?: unknown): void {
    if (!this.enabled) return;
    log(LogLevel.DEBUG, this.module, message, data, styles.dim);
  }

  info(message: string, data?: unknown): void {
    if (!this.enabled) return;
    log(LogLevel.INFO, this.module, message, data, styles.info);
  }

  success(message: string, data?: unknown): void {
    if (!this.enabled) return;
    log(LogLevel.INFO, this.module, message, data, styles.success);
  }

  warn(message: string, data?: unknown): void {
    if (!this.enabled) return;
    log(LogLevel.WARN, this.module, message, data, styles.warning);
  }

  error(message: string, data?: unknown): void {
    if (!this.enabled) return;
    log(LogLevel.ERROR, this.module, message, data, styles.error);
  }

  // Specialized logging for rate limit errors
  rateLimitError(endpoint: string, errorData: unknown): void {
    if (!this.enabled) return;

    console.group(`%c[${this.module}] RATE LIMIT ERROR`, styles.rateLimitError);
    console.log('%cEndpoint:', styles.info, endpoint);
    console.log('%cError Data:', styles.info, errorData);
    console.log('%cTimestamp:', styles.dim, new Date().toISOString());

    // Track the request
    requestTracker.addRequest({
      timestamp: Date.now(),
      endpoint,
      method: 'RPC',
      success: false,
      error: 'Rate limit exceeded',
      errorCode: -32016
    });

    // Show rate limit stats
    const stats = requestTracker.getRateLimitStats();
    if (stats.length > 0) {
      console.log('%cRate Limit Stats (last 60s):', styles.warning);
      console.table(stats);
    }

    console.groupEnd();
  }

  // Specialized logging for RPC errors (like 404 for missing functions)
  rpcError(functionName: string, error: unknown, fallbackUsed?: string): void {
    if (!this.enabled) return;

    console.group(`%c[${this.module}] RPC FUNCTION ERROR`, styles.rpcError);
    console.log('%cFunction:', styles.info, functionName);
    console.log('%cError:', styles.error, error);
    if (fallbackUsed) {
      console.log('%cFallback:', styles.warning, fallbackUsed);
    }
    console.log('%cTimestamp:', styles.dim, new Date().toISOString());

    // Track the request
    requestTracker.addRequest({
      timestamp: Date.now(),
      endpoint: functionName,
      method: 'RPC',
      success: false,
      error: typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error),
      errorCode: 404
    });

    console.groupEnd();
  }

  // Specialized logging for Edge Function errors
  edgeFunctionError(functionName: string, error: unknown, attempt?: number, maxAttempts?: number): void {
    if (!this.enabled) return;

    console.group(`%c[${this.module}] EDGE FUNCTION ERROR`, styles.networkError);
    console.log('%cFunction:', styles.info, functionName);
    if (attempt !== undefined && maxAttempts !== undefined) {
      console.log('%cAttempt:', styles.warning, `${attempt}/${maxAttempts}`);
    }
    console.log('%cError:', styles.error, error);

    // Parse error for more details
    if (error && typeof error === 'object') {
      const err = error as Record<string, unknown>;
      if (err.message) console.log('%cMessage:', styles.info, err.message);
      if (err.name) console.log('%cType:', styles.info, err.name);
      if (err.context) console.log('%cContext:', styles.dim, err.context);
    }

    console.log('%cTimestamp:', styles.dim, new Date().toISOString());

    // Track the request
    requestTracker.addRequest({
      timestamp: Date.now(),
      endpoint: `edge:${functionName}`,
      method: 'EDGE_FUNCTION',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      errorCode: 'FETCH_ERROR'
    });

    console.groupEnd();
  }

  // Log successful operations with timing
  successWithTiming(operation: string, startTime: number, data?: unknown): void {
    if (!this.enabled) return;

    const duration = Date.now() - startTime;
    const durationStyle = duration > 1000 ? styles.warning : styles.success;

    console.log(
      `%c[${this.module}] ${operation} completed in %c${duration}ms`,
      styles.success,
      durationStyle,
      data !== undefined ? data : ''
    );

    // Track the request
    requestTracker.addRequest({
      timestamp: Date.now(),
      endpoint: operation,
      method: 'SUCCESS',
      success: true,
      duration
    });
  }

  // Group related logs together
  group(title: string, collapsed = false): void {
    if (!this.enabled) return;
    if (collapsed) {
      console.groupCollapsed(`%c[${this.module}] ${title}`, styles.header);
    } else {
      console.group(`%c[${this.module}] ${title}`, styles.header);
    }
  }

  groupEnd(): void {
    if (!this.enabled) return;
    console.groupEnd();
  }

  // Log request/response pairs
  request(endpoint: string, params?: unknown): void {
    if (!this.enabled) return;
    console.log(`%c[${this.module}] → ${endpoint}`, styles.info, params || '');
  }

  response(endpoint: string, data?: unknown, success = true): void {
    if (!this.enabled) return;
    const arrow = success ? '✓' : '✗';
    const style = success ? styles.success : styles.error;
    console.log(`%c[${this.module}] ${arrow} ${endpoint}`, style, data || '');
  }
}

// Pre-configured loggers for specific modules
export const walletTokensLogger = new DebugLogger('useWalletTokens');
export const ticketReservationLogger = new DebugLogger('TicketReservation');
export const databaseLogger = new DebugLogger('Database');
export const entriesLogger = new DebugLogger('EntriesFilter');

// Debug dashboard for console
export function showDebugDashboard(): void {
  console.clear();
  console.log('%c=== Prize.io Debug Dashboard ===', 'color: #00bfff; font-size: 18px; font-weight: bold');
  console.log('%cTimestamp: ' + new Date().toISOString(), styles.dim);
  console.log('');

  // Rate limit statistics
  console.log('%c📊 Rate Limit Statistics (last 60s)', styles.header);
  const rateLimitStats = requestTracker.getRateLimitStats();
  if (rateLimitStats.length > 0) {
    console.table(rateLimitStats.map(s => ({
      endpoint: s.endpoint,
      hits: s.hitsLast60s,
      lastHit: new Date(s.lastHit).toISOString().split('T')[1].slice(0, 12)
    })));
  } else {
    console.log('%cNo rate limit errors in the last 60 seconds', styles.success);
  }
  console.log('');

  // Error summary
  console.log('%c⚠️ Error Summary', styles.header);
  const errorSummary = requestTracker.getErrorSummary();
  if (errorSummary.length > 0) {
    console.table(errorSummary.map(e => ({
      errorCode: e.errorCode,
      count: e.count,
      lastOccurrence: new Date(e.lastOccurrence).toISOString().split('T')[1].slice(0, 12)
    })));
  } else {
    console.log('%cNo errors recorded', styles.success);
  }
  console.log('');

  // Recent requests
  console.log('%c📋 Recent Requests', styles.header);
  const recentRequests = requestTracker.getRecentRequests(10);
  if (recentRequests.length > 0) {
    console.table(recentRequests.map(r => ({
      time: new Date(r.timestamp).toISOString().split('T')[1].slice(0, 12),
      endpoint: r.endpoint.length > 30 ? r.endpoint.slice(0, 30) + '...' : r.endpoint,
      status: r.success ? '✓' : '✗',
      error: r.errorCode || '-',
      duration: r.duration ? `${r.duration}ms` : '-'
    })));
  } else {
    console.log('%cNo requests recorded yet', styles.dim);
  }
  console.log('');

  // Help
  console.log('%c💡 Commands', styles.header);
  console.log('%cenableDebug()%c - Enable verbose debugging', styles.highlight, styles.dim);
  console.log('%cdisableDebug()%c - Disable debugging', styles.highlight, styles.dim);
  console.log('%cshowDebugDashboard()%c - Show this dashboard', styles.highlight, styles.dim);
  console.log('%crequestTracker.clear()%c - Clear request history', styles.highlight, styles.dim);
}

// Export to window for console access
if (typeof window !== 'undefined') {
  (window as any).enableDebug = enableDebug;
  (window as any).disableDebug = disableDebug;
  (window as any).showDebugDashboard = showDebugDashboard;
  (window as any).requestTracker = requestTracker;
  (window as any).prizeDebug = {
    enable: enableDebug,
    disable: disableDebug,
    dashboard: showDebugDashboard,
    tracker: requestTracker,
    loggers: {
      walletTokens: walletTokensLogger,
      ticketReservation: ticketReservationLogger,
      database: databaseLogger,
      entries: entriesLogger
    }
  };
}

// Auto-show dashboard hint on first error
let hasShownHint = false;
export function showDebugHintOnError(): void {
  if (hasShownHint) return;
  hasShownHint = true;
  console.log(
    '%c💡 Tip: Run %cshowDebugDashboard()%c in console to see error statistics',
    styles.dim,
    styles.highlight,
    styles.dim
  );
}

/**
 * Global Error Monitor - captures all unhandled errors and promise rejections
 */
interface ErrorLogEntry {
  timestamp: number;
  type: 'error' | 'unhandledRejection' | 'apiError' | 'supabaseError';
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  url?: string;
}

class GlobalErrorMonitor {
  private errorLog: ErrorLogEntry[] = [];
  private maxEntries = 100;
  private isInitialized = false;

  initialize(): void {
    if (this.isInitialized || typeof window === 'undefined') return;

    // Capture unhandled errors
    window.addEventListener('error', (event) => {
      this.logError({
        type: 'error',
        message: event.message || 'Unknown error',
        stack: event.error?.stack,
        context: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        },
        url: window.location.href
      });
    });

    // Capture unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      this.logError({
        type: 'unhandledRejection',
        message: reason?.message || String(reason) || 'Unhandled promise rejection',
        stack: reason?.stack,
        context: {
          reason: typeof reason === 'object' ? JSON.stringify(reason) : String(reason)
        },
        url: window.location.href
      });
    });

    // Monkey-patch fetch to capture API errors
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const startTime = Date.now();
      const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url || 'unknown';

      try {
        const response = await originalFetch.apply(window, args);

        // Log failed responses
        if (!response.ok) {
          const duration = Date.now() - startTime;
          let errorBody = '';
          try {
            // Clone the response to read the body
            const cloned = response.clone();
            errorBody = await cloned.text();
          } catch {
            // Ignore body read errors
          }

          this.logError({
            type: 'apiError',
            message: `HTTP ${response.status}: ${response.statusText}`,
            context: {
              url,
              status: response.status,
              statusText: response.statusText,
              duration,
              body: errorBody.slice(0, 500) // Truncate long bodies
            },
            url: window.location.href
          });

          // Also track in request tracker
          requestTracker.addRequest({
            timestamp: Date.now(),
            endpoint: url.replace(/https?:\/\/[^/]+/, '').slice(0, 50),
            method: (args[1] as RequestInit)?.method || 'GET',
            success: false,
            error: `HTTP ${response.status}`,
            errorCode: response.status,
            duration
          });
        } else {
          // Track successful requests too
          requestTracker.addRequest({
            timestamp: Date.now(),
            endpoint: url.replace(/https?:\/\/[^/]+/, '').slice(0, 50),
            method: (args[1] as RequestInit)?.method || 'GET',
            success: true,
            duration: Date.now() - startTime
          });
        }

        return response;
      } catch (error: unknown) {
        const duration = Date.now() - startTime;
        const err = error as Error;

        this.logError({
          type: 'apiError',
          message: err.message || 'Network error',
          stack: err.stack,
          context: {
            url,
            duration,
            name: err.name
          },
          url: window.location.href
        });

        requestTracker.addRequest({
          timestamp: Date.now(),
          endpoint: url.replace(/https?:\/\/[^/]+/, '').slice(0, 50),
          method: (args[1] as RequestInit)?.method || 'GET',
          success: false,
          error: err.message,
          errorCode: 'NETWORK_ERROR',
          duration
        });

        throw error;
      }
    };

    this.isInitialized = true;
    console.log('%c[ErrorMonitor] Global error monitoring initialized', styles.success);
  }

  logError(entry: Omit<ErrorLogEntry, 'timestamp'>): void {
    const fullEntry: ErrorLogEntry = {
      ...entry,
      timestamp: Date.now()
    };

    this.errorLog.push(fullEntry);
    if (this.errorLog.length > this.maxEntries) {
      this.errorLog.shift();
    }

    // Log to console with styling
    console.group(`%c[ErrorMonitor] ${entry.type.toUpperCase()}`, styles.error);
    console.log('%cMessage:', styles.info, entry.message);
    if (entry.stack) {
      console.log('%cStack:', styles.dim, entry.stack);
    }
    if (entry.context) {
      console.log('%cContext:', styles.info, entry.context);
    }
    console.log('%cURL:', styles.dim, entry.url);
    console.log('%cTime:', styles.dim, new Date().toISOString());
    console.groupEnd();

    // Persist to localStorage for post-session analysis
    this.persistErrors();
  }

  logSupabaseError(operation: string, error: unknown): void {
    const err = error as Record<string, unknown>;
    this.logError({
      type: 'supabaseError',
      message: (err.message as string) || 'Supabase error',
      context: {
        operation,
        code: err.code,
        details: err.details,
        hint: err.hint
      },
      url: typeof window !== 'undefined' ? window.location.href : 'server'
    });
  }

  getErrors(limit = 20): ErrorLogEntry[] {
    return this.errorLog.slice(-limit);
  }

  getErrorsByType(type: ErrorLogEntry['type']): ErrorLogEntry[] {
    return this.errorLog.filter(e => e.type === type);
  }

  clearErrors(): void {
    this.errorLog = [];
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(ERROR_LOG_KEY);
    }
  }

  private persistErrors(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(this.errorLog.slice(-50)));
    } catch {
      // localStorage full or unavailable
    }
  }

  loadPersistedErrors(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const stored = localStorage.getItem(ERROR_LOG_KEY);
      if (stored) {
        this.errorLog = JSON.parse(stored);
      }
    } catch {
      // Corrupted data
    }
  }

  showErrorReport(): void {
    console.clear();
    console.log('%c=== Prize.io Error Report ===', 'color: #ff3333; font-size: 18px; font-weight: bold');
    console.log('%cTimestamp: ' + new Date().toISOString(), styles.dim);
    console.log('%cTotal Errors: ' + this.errorLog.length, styles.info);
    console.log('');

    // Group by type
    const byType = new Map<string, ErrorLogEntry[]>();
    this.errorLog.forEach(e => {
      const list = byType.get(e.type) || [];
      list.push(e);
      byType.set(e.type, list);
    });

    byType.forEach((errors, type) => {
      console.log(`%c${type.toUpperCase()} (${errors.length})`, styles.header);
      console.table(errors.slice(-5).map(e => ({
        time: new Date(e.timestamp).toISOString().split('T')[1].slice(0, 12),
        message: e.message.slice(0, 50) + (e.message.length > 50 ? '...' : ''),
        context: JSON.stringify(e.context || {}).slice(0, 30)
      })));
      console.log('');
    });
  }
}

// Create and export global error monitor
export const globalErrorMonitor = new GlobalErrorMonitor();

// Auto-initialize on module load
if (typeof window !== 'undefined') {
  globalErrorMonitor.loadPersistedErrors();
  globalErrorMonitor.initialize();

  // Export to window for console access
  (window as unknown as Record<string, unknown>).enableDebug = enableDebug;
  (window as unknown as Record<string, unknown>).disableDebug = disableDebug;
  (window as unknown as Record<string, unknown>).showDebugDashboard = showDebugDashboard;
  (window as unknown as Record<string, unknown>).requestTracker = requestTracker;
  (window as unknown as Record<string, unknown>).errorMonitor = globalErrorMonitor;
  (window as unknown as Record<string, unknown>).showErrorReport = () => globalErrorMonitor.showErrorReport();
  (window as unknown as Record<string, unknown>).prizeDebug = {
    enable: enableDebug,
    disable: disableDebug,
    dashboard: showDebugDashboard,
    errorReport: () => globalErrorMonitor.showErrorReport(),
    tracker: requestTracker,
    errors: globalErrorMonitor,
    loggers: {
      walletTokens: walletTokensLogger,
      ticketReservation: ticketReservationLogger,
      database: databaseLogger,
      entries: entriesLogger
    }
  };
}

export default {
  enableDebug,
  disableDebug,
  showDebugDashboard,
  requestTracker,
  globalErrorMonitor,
  walletTokensLogger,
  ticketReservationLogger,
  databaseLogger,
  entriesLogger,
  DebugLogger,
  LogLevel,
  setLogLevel,
  showDebugHintOnError
};
