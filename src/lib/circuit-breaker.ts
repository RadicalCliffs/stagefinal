/**
 * Circuit Breaker Pattern Implementation
 *
 * Provides fault tolerance for external service calls by:
 * - Tracking failures and opening the circuit when threshold is exceeded
 * - Preventing cascading failures by fast-failing requests when circuit is open
 * - Automatically testing recovery with half-open state
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms to wait before testing recovery */
  resetTimeout: number;
  /** Number of successful calls in half-open state before closing */
  successThreshold: number;
  /** Optional name for logging */
  name?: string;
  /** Optional callback when state changes */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  failureThreshold: 5,
  resetTimeout: 60000, // 1 minute
  successThreshold: 2,
  name: 'default'
};

export class CircuitBreaker {
  private failures = 0;
  private successes = 0;
  private lastFailure = 0;
  private state: CircuitState = 'CLOSED';
  private options: CircuitBreakerOptions;

  constructor(options: Partial<CircuitBreakerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit statistics
   */
  getStats(): {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailure: number;
    timeSinceLastFailure: number;
  } {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure,
      timeSinceLastFailure: this.lastFailure > 0 ? Date.now() - this.lastFailure : 0
    };
  }

  /**
   * Execute an operation with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check if circuit should transition from OPEN to HALF_OPEN
    if (this.state === 'OPEN') {
      const timeSinceFailure = Date.now() - this.lastFailure;
      if (timeSinceFailure >= this.options.resetTimeout) {
        this.transitionTo('HALF_OPEN');
      } else {
        const remainingTime = Math.ceil((this.options.resetTimeout - timeSinceFailure) / 1000);
        throw new CircuitBreakerError(
          `Circuit breaker [${this.options.name}] is OPEN. Retry in ${remainingTime}s`,
          this.state,
          this.getStats()
        );
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Execute with fallback - returns fallback value instead of throwing when circuit is open
   */
  async executeWithFallback<T>(
    operation: () => Promise<T>,
    fallback: T | (() => T)
  ): Promise<T> {
    try {
      return await this.execute(operation);
    } catch (error) {
      if (error instanceof CircuitBreakerError) {
        console.warn(`[CircuitBreaker:${this.options.name}] Using fallback due to open circuit`);
        return typeof fallback === 'function' ? (fallback as () => T)() : fallback;
      }
      throw error;
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.failures = 0;

    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.options.successThreshold) {
        this.transitionTo('CLOSED');
        this.successes = 0;
      }
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    this.successes = 0;

    if (this.state === 'HALF_OPEN') {
      // Immediately open on any failure in half-open state
      this.transitionTo('OPEN');
    } else if (this.failures >= this.options.failureThreshold) {
      this.transitionTo('OPEN');
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;

    console.log(`[CircuitBreaker:${this.options.name}] State change: ${oldState} → ${newState}`);

    if (this.options.onStateChange) {
      this.options.onStateChange(oldState, newState);
    }
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.failures = 0;
    this.successes = 0;
    this.lastFailure = 0;
    this.transitionTo('CLOSED');
  }

  /**
   * Manually open the circuit (for testing or emergency shutdown)
   */
  forceOpen(): void {
    this.transitionTo('OPEN');
    this.lastFailure = Date.now();
  }
}

/**
 * Custom error for circuit breaker failures
 */
export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly circuitState: CircuitState,
    public readonly stats: ReturnType<CircuitBreaker['getStats']>
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

/**
 * Circuit breaker registry for managing multiple breakers
 */
class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();

  /**
   * Get or create a circuit breaker by name
   */
  get(name: string, options?: Partial<CircuitBreakerOptions>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker({ ...options, name }));
    }
    return this.breakers.get(name)!;
  }

  /**
   * Get all circuit breakers and their states
   */
  getAll(): Map<string, { breaker: CircuitBreaker; stats: ReturnType<CircuitBreaker['getStats']> }> {
    const result = new Map();
    this.breakers.forEach((breaker, name) => {
      result.set(name, { breaker, stats: breaker.getStats() });
    });
    return result;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    this.breakers.forEach(breaker => breaker.reset());
  }

  /**
   * Remove a circuit breaker
   */
  remove(name: string): boolean {
    return this.breakers.delete(name);
  }
}

// Export singleton registry
export const circuitBreakerRegistry = new CircuitBreakerRegistry();

/**
 * Pre-configured circuit breakers for common services
 */
export const circuitBreakers = {
  /** Database operations */
  database: circuitBreakerRegistry.get('database', {
    failureThreshold: 5,
    resetTimeout: 30000, // 30 seconds
    successThreshold: 2
  }),

  /** Payment processing */
  payments: circuitBreakerRegistry.get('payments', {
    failureThreshold: 3,
    resetTimeout: 60000, // 1 minute
    successThreshold: 3
  }),

  /** External API calls */
  externalApi: circuitBreakerRegistry.get('externalApi', {
    failureThreshold: 5,
    resetTimeout: 120000, // 2 minutes
    successThreshold: 2
  }),

  /** Supabase operations */
  supabase: circuitBreakerRegistry.get('supabase', {
    failureThreshold: 5,
    resetTimeout: 30000,
    successThreshold: 2
  })
};

/**
 * Decorator-style wrapper for functions
 */
export function withCircuitBreaker<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  breakerName: string,
  options?: Partial<CircuitBreakerOptions>
): T {
  const breaker = circuitBreakerRegistry.get(breakerName, options);

  return (async (...args: Parameters<T>) => {
    return breaker.execute(() => fn(...args));
  }) as T;
}

/**
 * Helper to create a protected async function
 */
export function createProtectedFunction<TArgs extends any[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
  breakerName: string,
  fallback?: TReturn
): (...args: TArgs) => Promise<TReturn> {
  const breaker = circuitBreakerRegistry.get(breakerName);

  return async (...args: TArgs): Promise<TReturn> => {
    if (fallback !== undefined) {
      return breaker.executeWithFallback(() => fn(...args), fallback);
    }
    return breaker.execute(() => fn(...args));
  };
}
