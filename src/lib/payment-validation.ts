/**
 * Payment Flow Validation Utilities
 * 
 * These functions add validation checks to ensure payment flows complete successfully
 * and provide detailed logging for debugging.
 */

// Validation constants
const MIN_USER_ID_LENGTH = 5;
const MAX_TICKET_COUNT = 100;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PaymentValidationContext {
  userId: string;
  competitionId: string;
  ticketCount: number;
  ticketPrice: number;
  paymentMethod: 'balance' | 'base' | 'other_crypto';
  userBalance?: number;
  selectedTickets?: number[];
  reservationId?: string | null;
}

/**
 * Validate payment initiation parameters
 */
export function validatePaymentInitiation(context: PaymentValidationContext): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // User ID validation
  if (!context.userId) {
    errors.push('User ID is required');
  } else if (context.userId.length < MIN_USER_ID_LENGTH) {
    warnings.push('User ID looks suspiciously short');
  }

  // Competition ID validation
  if (!context.competitionId) {
    errors.push('Competition ID is required');
  }

  // Ticket count validation
  if (!context.ticketCount || context.ticketCount <= 0) {
    errors.push('Ticket count must be greater than 0');
  } else if (context.ticketCount > MAX_TICKET_COUNT) {
    warnings.push('Unusually high ticket count - verify this is intentional');
  }

  // Ticket price validation
  if (!context.ticketPrice || context.ticketPrice <= 0) {
    errors.push('Ticket price must be greater than 0');
  } else if (!Number.isFinite(context.ticketPrice)) {
    errors.push('Ticket price must be a valid number');
  }

  // Balance payment validation
  if (context.paymentMethod === 'balance') {
    if (context.userBalance === undefined) {
      errors.push('User balance is required for balance payments');
    } else {
      const totalCost = context.ticketCount * context.ticketPrice;
      if (context.userBalance < totalCost) {
        errors.push(`Insufficient balance: need $${totalCost.toFixed(2)} but have $${context.userBalance.toFixed(2)}`);
      }
    }
  }

  // Ticket selection validation
  if (context.selectedTickets && context.selectedTickets.length > 0) {
    if (context.selectedTickets.length !== context.ticketCount) {
      errors.push(`Selected tickets count (${context.selectedTickets.length}) doesn't match ticket count (${context.ticketCount})`);
    }
    
    // Check for duplicates
    const uniqueTickets = new Set(context.selectedTickets);
    if (uniqueTickets.size !== context.selectedTickets.length) {
      errors.push('Duplicate ticket numbers detected in selection');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate payment success response
 */
export function validatePaymentSuccess(response: any, expectedTicketCount: number): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Response structure validation
  if (!response) {
    errors.push('Payment response is null or undefined');
    return { valid: false, errors, warnings };
  }

  // Success flag validation
  if (!response.success) {
    errors.push('Payment response indicates failure');
    if (response.error) {
      errors.push(`Error message: ${response.error}`);
    }
  }

  // Ticket creation validation
  if (response.ticketsCreated) {
    if (typeof response.ticketsCreated !== 'string' && typeof response.ticketsCreated !== 'number') {
      warnings.push('Unexpected ticketsCreated format');
    }
  } else {
    warnings.push('No ticketsCreated field in response');
  }

  // Balance validation (for balance payments)
  if (response.balanceAfterPurchase !== undefined) {
    if (typeof response.balanceAfterPurchase !== 'number' || !Number.isFinite(response.balanceAfterPurchase)) {
      errors.push('Invalid balanceAfterPurchase value');
    } else if (response.balanceAfterPurchase < 0) {
      errors.push('Balance after purchase is negative');
    }
  }

  // Tickets validation
  if (response.tickets) {
    if (!Array.isArray(response.tickets)) {
      errors.push('Tickets field is not an array');
    } else if (response.tickets.length !== expectedTicketCount) {
      warnings.push(`Expected ${expectedTicketCount} tickets but got ${response.tickets.length}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Log validation results with proper formatting
 */
export function logValidationResults(context: string, result: ValidationResult): void {
  if (!result.valid) {
    console.error(`[Validation Error] ${context}:`, {
      errors: result.errors,
      warnings: result.warnings
    });
  } else if (result.warnings.length > 0) {
    console.warn(`[Validation Warning] ${context}:`, {
      warnings: result.warnings
    });
  } else {
    console.log(`[Validation Success] ${context}: All checks passed`);
  }
}

/**
 * Validate dashboard entry creation
 */
export async function validateEntryCreation(
  userId: string,
  competitionId: string,
  expectedTicketCount: number,
  supabase: any
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Query for entries
    const { data, error } = await supabase
      .from('v_joincompetition_active')
      .select('*')
      .eq('userid', userId)
      .eq('competitionid', competitionId)
      .order('purchasedate', { ascending: false })
      .limit(1);

    if (error) {
      errors.push(`Database query failed: ${error.message}`);
      return { valid: false, errors, warnings };
    }

    if (!data || data.length === 0) {
      errors.push('No entry found in database after payment');
      return { valid: false, errors, warnings };
    }

    const entry = data[0];

    // Validate entry fields
    if (!entry.ticketnumbers) {
      errors.push('Entry has no ticket numbers');
    } else {
      const ticketNumbers = typeof entry.ticketnumbers === 'string' 
        ? entry.ticketnumbers.split(',').map((t: string) => parseInt(t.trim(), 10))
        : Array.isArray(entry.ticketnumbers)
          ? entry.ticketnumbers
          : [];

      if (ticketNumbers.length !== expectedTicketCount) {
        warnings.push(`Expected ${expectedTicketCount} tickets but entry has ${ticketNumbers.length}`);
      }
    }

    if (!entry.transactionhash && !entry.tx_id) {
      warnings.push('Entry has no transaction reference');
    }

    if (!entry.purchasedate) {
      warnings.push('Entry has no purchase date');
    }

    console.log('[Entry Validation] Entry created successfully:', {
      entryId: entry.uid,
      ticketCount: entry.numberoftickets,
      amount: entry.amountspent,
      date: entry.purchasedate
    });

  } catch (error) {
    errors.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Comprehensive payment flow validation
 * Call this after each payment attempt to ensure everything worked
 */
export async function validateCompletePaymentFlow(
  context: PaymentValidationContext,
  paymentResponse: any,
  supabase: any
): Promise<{
  success: boolean;
  validations: {
    initiation: ValidationResult;
    response: ValidationResult;
    entry: ValidationResult;
  };
}> {
  // Step 1: Validate initiation
  const initiationResult = validatePaymentInitiation(context);
  logValidationResults('Payment Initiation', initiationResult);

  // Step 2: Validate response
  const responseResult = validatePaymentSuccess(paymentResponse, context.ticketCount);
  logValidationResults('Payment Response', responseResult);

  // Step 3: Validate entry creation (if payment was successful)
  let entryResult: ValidationResult = { valid: true, errors: [], warnings: [] };
  if (paymentResponse?.success) {
    // Wait a moment for database write
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    entryResult = await validateEntryCreation(
      context.userId,
      context.competitionId,
      context.ticketCount,
      supabase
    );
    logValidationResults('Entry Creation', entryResult);
  }

  const allValid = initiationResult.valid && responseResult.valid && entryResult.valid;

  // Log comprehensive summary
  console.log('[Payment Flow Validation] Complete summary:', {
    success: allValid,
    hasErrors: !allValid,
    totalErrors: [
      ...initiationResult.errors,
      ...responseResult.errors,
      ...entryResult.errors
    ].length,
    totalWarnings: [
      ...initiationResult.warnings,
      ...responseResult.warnings,
      ...entryResult.warnings
    ].length
  });

  return {
    success: allValid,
    validations: {
      initiation: initiationResult,
      response: responseResult,
      entry: entryResult
    }
  };
}

/**
 * Monitor payment flow performance
 */
export class PaymentFlowMonitor {
  private startTime: number;
  private checkpoints: Map<string, number>;

  constructor() {
    this.startTime = Date.now();
    this.checkpoints = new Map();
  }

  checkpoint(name: string): void {
    const now = Date.now();
    this.checkpoints.set(name, now);
    console.log(`[Payment Flow] ${name}: ${now - this.startTime}ms`);
  }

  getSummary(): {
    totalTime: number;
    checkpoints: { name: string; time: number; duration: number }[];
  } {
    const checkpoints: { name: string; time: number; duration: number }[] = [];
    let lastTime = this.startTime;

    this.checkpoints.forEach((time, name) => {
      checkpoints.push({
        name,
        time: time - this.startTime,
        duration: time - lastTime
      });
      lastTime = time;
    });

    return {
      totalTime: Date.now() - this.startTime,
      checkpoints
    };
  }

  logSummary(): void {
    const summary = this.getSummary();
    console.log('[Payment Flow] Performance Summary:', {
      totalTime: `${summary.totalTime}ms`,
      checkpoints: summary.checkpoints.map(cp => ({
        name: cp.name,
        time: `${cp.time}ms`,
        duration: `${cp.duration}ms`
      }))
    });
  }
}
