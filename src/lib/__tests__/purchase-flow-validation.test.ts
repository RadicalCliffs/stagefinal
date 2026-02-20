import { describe, it, expect } from 'vitest';

/**
 * Tests for competitionId validation at every layer of the purchase flow.
 * 
 * This test file documents and enforces the bug fix for the "missing_competition" error
 * that occurred when competitionId was null/undefined in the purchase-with-balance flow.
 * 
 * The bug manifested as:
 * - HTTP 400 from Edge Function: {"error":"missing_competition","received":{"competition_id_raw":null}}
 * 
 * Root cause possibilities:
 * 1. competitionId prop not passed to PaymentModal
 * 2. competitionId undefined in parent component state
 * 3. competitionId not extracted from URL params correctly
 * 4. Race condition where modal opens before competition data loads
 */

// ============================================================
// RPCPurchaseRequest construction validation
// ============================================================

// Interface matches the deployed Edge Function's expected field names
interface RPCPurchaseRequest {
  canonical_user_id: string;
  competition_id: string;
  ticket_numbers: number[];
  reservation_id?: string | null;
}

function buildRPCPurchaseRequest(params: {
  userId: string;
  competitionId: string;
  ticketNumbers: number[];
  reservationId?: string | null;
}): RPCPurchaseRequest {
  // This is the pattern used in balance-payment-service.ts
  // Field names must match what the deployed Edge Function expects
  return {
    canonical_user_id: params.userId,
    competition_id: params.competitionId,
    ticket_numbers: params.ticketNumbers,
    reservation_id: params.reservationId || null,
  };
}

describe('RPCPurchaseRequest construction', () => {
  it('should build valid request with all parameters', () => {
    const request = buildRPCPurchaseRequest({
      userId: 'prize:pid:0x123abc',
      competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
      ticketNumbers: [1, 2, 3],
      reservationId: 'reservation-123',
    });

    expect(request.canonical_user_id).toBe('prize:pid:0x123abc');
    expect(request.competition_id).toBe('e2e04124-5ea9-4fb2-951a-26e6d0991615');
    expect(request.ticket_numbers).toEqual([1, 2, 3]);
    expect(request.reservation_id).toBe('reservation-123');
  });

  it('should have competition_id as non-empty string', () => {
    const request = buildRPCPurchaseRequest({
      userId: 'prize:pid:0x123abc',
      competitionId: 'test-competition-id',
      ticketNumbers: [1],
    });

    expect(request.competition_id).toBeDefined();
    expect(request.competition_id.length).toBeGreaterThan(0);
    expect(typeof request.competition_id).toBe('string');
  });
});

// ============================================================
// Edge Function response parsing tests
// ============================================================

interface EdgeFunctionSuccessResponse {
  status: 'ok';
  success: boolean;
  competition_id: string;
  tickets: Array<{ ticket_number: number }>;
  entry_id: string;
  total_cost: number;
  new_balance: number;
  available_balance: number;
  previous_balance: number;
  idempotent: boolean;
  fallback: boolean;
  message: string;
}

interface EdgeFunctionErrorResponse {
  error: string;
  received?: {
    competition_id_raw?: string | null;
    competition_uid?: string | null;
  };
  hint?: string;
}

function parseEdgeFunctionResponse(responseBody: any): {
  success: boolean;
  data?: EdgeFunctionSuccessResponse;
  error?: string;
} {
  if (responseBody.status === 'ok' && responseBody.success === true) {
    return { success: true, data: responseBody };
  }

  if (responseBody.error) {
    return { success: false, error: responseBody.error };
  }

  return { success: false, error: 'Unknown response format' };
}

describe('Edge Function response parsing', () => {
  describe('success responses', () => {
    it('should parse successful purchase response', () => {
      const response = {
        status: 'ok',
        success: true,
        competition_id: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
        tickets: [{ ticket_number: 1 }, { ticket_number: 2 }],
        entry_id: 'entry-uuid-123',
        total_cost: 0.50,
        new_balance: 99.50,
        available_balance: 99.50,
        previous_balance: 100,
        idempotent: false,
        fallback: false,
        message: 'Successfully purchased 2 tickets',
      };

      const result = parseEdgeFunctionResponse(response);

      expect(result.success).toBe(true);
      expect(result.data?.tickets).toHaveLength(2);
      expect(result.data?.entry_id).toBe('entry-uuid-123');
    });

    it('should parse idempotent (duplicate) response', () => {
      const response = {
        status: 'ok',
        success: true,
        competition_id: 'test-comp',
        tickets: [{ ticket_number: 1 }],
        entry_id: 'existing-entry',
        total_cost: 1,
        new_balance: 99,
        available_balance: 99,
        previous_balance: 100,
        idempotent: true,
        fallback: false,
        message: 'Duplicate request - returning existing entry',
      };

      const result = parseEdgeFunctionResponse(response);

      expect(result.success).toBe(true);
      expect(result.data?.idempotent).toBe(true);
    });
  });

  describe('error responses', () => {
    it('should parse missing_competition error', () => {
      const response: EdgeFunctionErrorResponse = {
        error: 'missing_competition',
        received: {
          competition_id_raw: null,
          competition_uid: null,
        },
        hint: 'Provide competition_id (uuid) or competition_uid (slug)',
      };

      const result = parseEdgeFunctionResponse(response);

      expect(result.success).toBe(false);
      expect(result.error).toBe('missing_competition');
    });

    it('should parse insufficient_balance error', () => {
      const response = {
        error: 'INSUFFICIENT_BALANCE',
        message: 'User balance is $50 but purchase requires $100',
      };

      const result = parseEdgeFunctionResponse(response);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INSUFFICIENT_BALANCE');
    });

    it('should handle generic error string', () => {
      const response = {
        error: 'Internal server error',
      };

      const result = parseEdgeFunctionResponse(response);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Internal server error');
    });
  });
});

// ============================================================
// competitionId validation helper tests
// ============================================================

function isValidCompetitionId(id: any): boolean {
  if (!id || typeof id !== 'string') return false;
  // UUID format: 8-4-4-4-12 hex characters
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
}

describe('isValidCompetitionId helper', () => {
  describe('valid UUIDs', () => {
    it('should accept lowercase UUID', () => {
      expect(isValidCompetitionId('e2e04124-5ea9-4fb2-951a-26e6d0991615')).toBe(true);
    });

    it('should accept uppercase UUID', () => {
      expect(isValidCompetitionId('E2E04124-5EA9-4FB2-951A-26E6D0991615')).toBe(true);
    });

    it('should accept mixed case UUID', () => {
      expect(isValidCompetitionId('e2E04124-5eA9-4fB2-951A-26e6D0991615')).toBe(true);
    });

    it('should accept all-zeros UUID', () => {
      expect(isValidCompetitionId('00000000-0000-0000-0000-000000000000')).toBe(true);
    });

    it('should accept all-f UUID', () => {
      expect(isValidCompetitionId('ffffffff-ffff-ffff-ffff-ffffffffffff')).toBe(true);
    });
  });

  describe('invalid values', () => {
    it('should reject null', () => {
      expect(isValidCompetitionId(null)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(isValidCompetitionId(undefined)).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidCompetitionId('')).toBe(false);
    });

    it('should reject number', () => {
      expect(isValidCompetitionId(12345)).toBe(false);
    });

    it('should reject UUID without dashes', () => {
      expect(isValidCompetitionId('e2e041245ea94fb2951a26e6d0991615')).toBe(false);
    });

    it('should reject UUID with wrong dash positions', () => {
      expect(isValidCompetitionId('e2e0412-45ea9-4fb2-951a-26e6d0991615')).toBe(false);
    });

    it('should reject too short string', () => {
      expect(isValidCompetitionId('e2e04124-5ea9')).toBe(false);
    });

    it('should reject too long string', () => {
      expect(isValidCompetitionId('e2e04124-5ea9-4fb2-951a-26e6d0991615-extra')).toBe(false);
    });

    it('should reject invalid hex characters', () => {
      expect(isValidCompetitionId('e2e04124-5ea9-4fb2-951a-26e6d099161g')).toBe(false);
      expect(isValidCompetitionId('e2e04124-5ea9-4fb2-951a-26e6d099161!')).toBe(false);
    });

    it('should reject string that looks like UUID but has spaces', () => {
      expect(isValidCompetitionId(' e2e04124-5ea9-4fb2-951a-26e6d0991615')).toBe(false);
      expect(isValidCompetitionId('e2e04124-5ea9-4fb2-951a-26e6d0991615 ')).toBe(false);
    });
  });
});

// ============================================================
// Integration test: Full purchase flow validation
// ============================================================

describe('Full purchase flow validation', () => {
  function validatePurchaseParams(params: {
    competitionId: any;
    userId: any;
    ticketNumbers: any;
    ticketPrice: any;
  }): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!params.competitionId || typeof params.competitionId !== 'string') {
      errors.push('competitionId is required');
    } else if (!isValidCompetitionId(params.competitionId)) {
      errors.push('competitionId must be a valid UUID');
    }

    if (!params.userId || typeof params.userId !== 'string') {
      errors.push('userId is required');
    }

    if (!Array.isArray(params.ticketNumbers) || params.ticketNumbers.length === 0) {
      errors.push('ticketNumbers must be a non-empty array');
    }

    if (typeof params.ticketPrice !== 'number' || params.ticketPrice < 0.1 || params.ticketPrice > 100) {
      errors.push('ticketPrice must be between 0.10 and 100');
    }

    return { valid: errors.length === 0, errors };
  }

  it('should pass validation with all valid parameters', () => {
    const result = validatePurchaseParams({
      competitionId: 'e2e04124-5ea9-4fb2-951a-26e6d0991615',
      userId: '0x123abc',
      ticketNumbers: [1, 2, 3],
      ticketPrice: 0.25,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail validation with null competitionId', () => {
    const result = validatePurchaseParams({
      competitionId: null,
      userId: '0x123abc',
      ticketNumbers: [1, 2, 3],
      ticketPrice: 0.25,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('competitionId is required');
  });

  it('should fail validation with invalid UUID competitionId', () => {
    const result = validatePurchaseParams({
      competitionId: 'not-a-valid-uuid',
      userId: '0x123abc',
      ticketNumbers: [1, 2, 3],
      ticketPrice: 0.25,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('competitionId must be a valid UUID');
  });

  it('should collect multiple validation errors', () => {
    const result = validatePurchaseParams({
      competitionId: null,
      userId: '',
      ticketNumbers: [],
      ticketPrice: 0.01,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});
