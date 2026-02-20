import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Mock all external dependencies
vi.mock('react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
    })),
  },
}));

vi.mock('../../contexts/AuthContext', () => ({
  useAuthUser: () => ({
    authenticated: true,
    baseUser: { id: '0x123abc' },
    linkedWallets: ['0x123abc'],
    profile: { wallet_address: '0x123abc' },
    login: vi.fn(),
    ready: true,
    refreshUserData: vi.fn(),
  }),
}));

vi.mock('wagmi', () => ({
  useWalletClient: () => ({ data: null }),
}));

vi.mock('../../hooks/useGetPaymentStatus', () => ({
  usePaymentStatus: () => ({
    paymentData: null,
    loading: false,
    paymentStatus: null,
  }),
}));

vi.mock('../../hooks/useBaseSubAccount', () => ({
  useBaseSubAccount: () => ({
    subAccount: null,
    loading: false,
    error: null,
  }),
}));

vi.mock('../../hooks/useRealtimeSubscriptions', () => ({
  useRealtimeSubscriptions: vi.fn(),
}));

vi.mock('../../hooks/useProactiveReservationMonitor', () => ({
  useProactiveReservationMonitor: vi.fn(),
}));

vi.mock('../../lib/reservation-storage', () => ({
  reservationStorage: {
    getReservation: vi.fn().mockReturnValue(null),
    saveReservation: vi.fn(),
    clearReservation: vi.fn(),
  },
}));

// Mock the image imports
vi.mock('../../assets/images', () => ({
  footerLogo: 'mocked-footer-logo.png',
  applePay: 'mocked-apple-pay.png',
  visaLogo: 'mocked-visa.png',
  masterCardLogo: 'mocked-mastercard.png',
}));

// Import the component after mocks
import PaymentModal from '../../components/PaymentModal';

describe('PaymentModal competitionId Validation - CRITICAL', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onOpen: vi.fn(),
    ticketCount: 1,
    ticketPrice: 1,
    selectedTickets: [1],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================
  // CRITICAL: competitionId validation tests
  // These tests ensure the PaymentModal NEVER attempts a purchase
  // with an invalid competitionId
  // ============================================================

  describe('FATAL ERROR display for invalid competitionId', () => {
    it('should show FATAL ERROR when competitionId is undefined', () => {
      render(
        <PaymentModal
          {...defaultProps}
          competitionId={undefined as any}
        />
      );

      expect(screen.getByText('FATAL ERROR')).toBeInTheDocument();
      expect(screen.getByText('Competition ID is missing or invalid.')).toBeInTheDocument();
    });

    it('should show FATAL ERROR when competitionId is null', () => {
      render(
        <PaymentModal
          {...defaultProps}
          competitionId={null as any}
        />
      );

      expect(screen.getByText('FATAL ERROR')).toBeInTheDocument();
    });

    it('should show FATAL ERROR when competitionId is empty string', () => {
      render(
        <PaymentModal
          {...defaultProps}
          competitionId=""
        />
      );

      expect(screen.getByText('FATAL ERROR')).toBeInTheDocument();
    });

    it('should show FATAL ERROR when competitionId is not a valid UUID', () => {
      render(
        <PaymentModal
          {...defaultProps}
          competitionId="invalid-not-a-uuid"
        />
      );

      expect(screen.getByText('FATAL ERROR')).toBeInTheDocument();
    });

    it('should show FATAL ERROR when competitionId is too short', () => {
      render(
        <PaymentModal
          {...defaultProps}
          competitionId="abc123"
        />
      );

      expect(screen.getByText('FATAL ERROR')).toBeInTheDocument();
    });

    it('should show FATAL ERROR for malformed UUID (missing dashes)', () => {
      render(
        <PaymentModal
          {...defaultProps}
          competitionId="e2e041245ea94fb2951a26e6d0991615"
        />
      );

      expect(screen.getByText('FATAL ERROR')).toBeInTheDocument();
    });
  });

  // ============================================================
  // Valid competitionId tests
  // ============================================================

  describe('valid competitionId acceptance', () => {
    it('should NOT show FATAL ERROR for valid UUID', () => {
      render(
        <PaymentModal
          {...defaultProps}
          competitionId="e2e04124-5ea9-4fb2-951a-26e6d0991615"
        />
      );

      expect(screen.queryByText('FATAL ERROR')).not.toBeInTheDocument();
    });

    it('should NOT show FATAL ERROR for another valid UUID', () => {
      render(
        <PaymentModal
          {...defaultProps}
          competitionId="550e8400-e29b-41d4-a716-446655440000"
        />
      );

      expect(screen.queryByText('FATAL ERROR')).not.toBeInTheDocument();
    });

    it('should NOT show FATAL ERROR for lowercase UUID', () => {
      render(
        <PaymentModal
          {...defaultProps}
          competitionId="550e8400-e29b-41d4-a716-446655440000"
        />
      );

      expect(screen.queryByText('FATAL ERROR')).not.toBeInTheDocument();
    });

    it('should NOT show FATAL ERROR for uppercase UUID', () => {
      render(
        <PaymentModal
          {...defaultProps}
          competitionId="550E8400-E29B-41D4-A716-446655440000"
        />
      );

      expect(screen.queryByText('FATAL ERROR')).not.toBeInTheDocument();
    });
  });

  // ============================================================
  // Reload button test
  // ============================================================

  describe('reload functionality', () => {
    it('should have a Reload button when showing FATAL ERROR', () => {
      render(
        <PaymentModal
          {...defaultProps}
          competitionId=""
        />
      );

      const reloadButton = screen.getByText('Reload Page');
      expect(reloadButton).toBeInTheDocument();
    });
  });
});

// ============================================================
// UUID validation regex tests
// ============================================================

describe('UUID validation regex', () => {
  const UUID_REGEX = /^([0-9a-fA-F-]{36})$/;

  describe('valid UUIDs', () => {
    it('should match standard UUID format', () => {
      expect(UUID_REGEX.test('e2e04124-5ea9-4fb2-951a-26e6d0991615')).toBe(true);
      expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(UUID_REGEX.test('00000000-0000-0000-0000-000000000000')).toBe(true);
      expect(UUID_REGEX.test('ffffffff-ffff-ffff-ffff-ffffffffffff')).toBe(true);
    });

    it('should match uppercase UUIDs', () => {
      expect(UUID_REGEX.test('E2E04124-5EA9-4FB2-951A-26E6D0991615')).toBe(true);
      expect(UUID_REGEX.test('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
    });

    it('should match mixed case UUIDs', () => {
      expect(UUID_REGEX.test('e2E04124-5eA9-4fB2-951a-26E6D0991615')).toBe(true);
    });
  });

  describe('invalid UUIDs', () => {
    it('should NOT match empty string', () => {
      expect(UUID_REGEX.test('')).toBe(false);
    });

    it('should NOT match too short strings', () => {
      expect(UUID_REGEX.test('e2e04124')).toBe(false);
      expect(UUID_REGEX.test('e2e04124-5ea9')).toBe(false);
    });

    it('should NOT match UUIDs without dashes', () => {
      expect(UUID_REGEX.test('e2e041245ea94fb2951a26e6d0991615')).toBe(false);
    });

    it('should NOT match strings with invalid characters', () => {
      expect(UUID_REGEX.test('e2e04124-5ea9-4fb2-951a-26e6d099161g')).toBe(false);
      expect(UUID_REGEX.test('e2e04124-5ea9-4fb2-951a-26e6d099161!')).toBe(false);
    });

    it('should NOT match strings that are too long', () => {
      expect(UUID_REGEX.test('e2e04124-5ea9-4fb2-951a-26e6d0991615-extra')).toBe(false);
    });
  });
});
