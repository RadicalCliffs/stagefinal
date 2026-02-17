/**
 * Integration tests for Dashboard Entries Service
 * 
 * These tests verify that the dashboardEntriesService functions:
 * 1. Correctly call Supabase RPCs with proper parameters
 * 2. Transform RPC responses to expected UI formats
 * 3. Handle errors gracefully
 * 4. Process different user identifier types
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchUserDashboardEntries,
  fetchUserEntriesDetailed,
  fetchCompetitionAvailability,
  fetchPurchasedTicketsByUser,
  loadUserOverview
} from '../dashboardEntriesService';

// Mock the Supabase client
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  }
}));

// Import the mocked supabase
import { supabase } from '../../lib/supabase';

describe('Dashboard Entries Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchUserDashboardEntries', () => {
    it('should fetch and transform dashboard entries', async () => {
      const mockRpcResponse = [
        {
          id: 'entry-1',
          competition_id: 'comp-1',
          title: 'Test Competition',
          description: 'Test Description',
          image: 'https://example.com/image.jpg',
          status: 'active',
          entry_type: 'completed',
          expires_at: null,
          is_winner: false,
          ticket_numbers: '1,2,3',
          number_of_tickets: 3,
          amount_spent: 3.0,
          purchase_date: '2026-02-10T08:00:00Z',
          wallet_address: '0x1234',
          transaction_hash: null,
          is_instant_win: false,
          prize_value: '100',
          competition_status: 'active',
          end_date: '2026-03-01T00:00:00Z'
        }
      ];

      (supabase.rpc as any).mockResolvedValue({
        data: mockRpcResponse,
        error: null
      });

      const userIdentifier = 'prize:pid:0x1234';
      const entries = await fetchUserDashboardEntries(userIdentifier);

      expect(supabase.rpc).toHaveBeenCalledWith(
        'get_comprehensive_user_dashboard_entries',
        { p_user_identifier: userIdentifier }
      );

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        competitionId: 'comp-1',
        competitionTitle: 'Test Competition',
        ticketNumber: 1,
        status: 'active',
        source: 'tickets',
        competitionUrl: '/competitions/comp-1'
      });
    });

    it('should handle empty results', async () => {
      (supabase.rpc as any).mockResolvedValue({
        data: [],
        error: null
      });

      const entries = await fetchUserDashboardEntries('0x1234');

      expect(entries).toEqual([]);
    });

    it('should throw error on RPC failure', async () => {
      (supabase.rpc as any).mockResolvedValue({
        data: null,
        error: { message: 'RPC failed', code: '42883' }
      });

      await expect(
        fetchUserDashboardEntries('0x1234')
      ).rejects.toThrow();
    });
  });

  describe('fetchUserEntriesDetailed', () => {
    it('should fetch detailed entries with user identifiers', async () => {
      const mockRpcResponse = [
        {
          id: 'entry-1',
          competition_id: 'comp-1',
          user_id: 'did:privy:abc123',
          canonical_user_id: 'prize:pid:0x1234',
          wallet_address: '0x1234567890123456789012345678901234567890',
          ticket_numbers: [1, 2, 3],
          ticket_count: 3,
          amount_paid: 3.0,
          currency: 'USD',
          transaction_hash: '0xtxhash',
          payment_provider: 'base_account',
          entry_status: 'completed',
          is_winner: false,
          prize_claimed: false,
          created_at: '2026-02-10T08:00:00Z',
          updated_at: '2026-02-10T08:00:00Z',
          competition_title: 'Test Competition',
          competition_description: 'Test Description',
          competition_image_url: 'https://example.com/image.jpg',
          competition_status: 'active',
          competition_end_date: '2026-03-01T00:00:00Z',
          competition_prize_value: 100,
          competition_is_instant_win: false
        }
      ];

      (supabase.rpc as any).mockResolvedValue({
        data: mockRpcResponse,
        error: null
      });

      const userIdentifier = 'prize:pid:0x1234';
      const entries = await fetchUserEntriesDetailed(userIdentifier);

      expect(supabase.rpc).toHaveBeenCalledWith(
        'get_user_competition_entries',
        { p_user_identifier: userIdentifier }
      );

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        competitionId: 'comp-1',
        competitionTitle: 'Test Competition',
        ticketNumber: 1,
        status: 'completed',
        source: 'tickets',
        canonicalUserId: 'prize:pid:0x1234',
        walletAddress: '0x1234567890123456789012345678901234567890',
        privyUserId: 'did:privy:abc123',
        competitionUrl: '/competitions/comp-1'
      });
    });
  });

  describe('fetchCompetitionAvailability', () => {
    it('should fetch and transform competition availability', async () => {
      const mockRpcResponse = {
        competition_id: 'comp-1',
        total_tickets: 1000,
        sold_count: 250,
        available_count: 750,
        available_tickets: [1, 2, 3, 4, 5]
      };

      (supabase.rpc as any).mockResolvedValue({
        data: mockRpcResponse,
        error: null
      });

      const availability = await fetchCompetitionAvailability('comp-1');

      expect(supabase.rpc).toHaveBeenCalledWith(
        'get_competition_ticket_availability',
        { p_competition_id: 'comp-1' }
      );

      expect(availability).toMatchObject({
        competitionId: 'comp-1',
        totalTickets: 1000,
        soldCount: 250,
        availableCount: 750,
        availableTickets: [1, 2, 3, 4, 5]
      });
    });

    it('should return null when competition not found', async () => {
      (supabase.rpc as any).mockResolvedValue({
        data: null,
        error: null
      });

      const availability = await fetchCompetitionAvailability('non-existent');

      expect(availability).toBeNull();
    });
  });

  describe('loadUserOverview', () => {
    it('should load entries and availability for all competitions', async () => {
      const mockEntriesResponse = [
        {
          id: 'entry-1',
          competition_id: 'comp-1',
          title: 'Competition 1',
          description: null,
          image: null,
          status: 'active',
          entry_type: 'completed',
          expires_at: null,
          is_winner: false,
          ticket_numbers: '1,2,3',
          number_of_tickets: 3,
          amount_spent: 3.0,
          purchase_date: '2026-02-10T08:00:00Z',
          wallet_address: '0x1234',
          transaction_hash: null,
          is_instant_win: false,
          prize_value: null,
          competition_status: 'active',
          end_date: null
        }
      ];

      let rpcCallCount = 0;
      (supabase.rpc as any).mockImplementation((funcName: string) => {
        if (funcName === 'get_comprehensive_user_dashboard_entries') {
          return Promise.resolve({ data: mockEntriesResponse, error: null });
        } else if (funcName === 'get_competition_ticket_availability') {
          rpcCallCount++;
          return Promise.resolve({
            data: {
              competition_id: 'comp-1',
              total_tickets: 1000,
              sold_count: 250,
              available_count: 750,
              available_tickets: [4, 5, 6]
            },
            error: null
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      const { entries, availabilityMap } = await loadUserOverview('prize:pid:0x1234');

      expect(entries).toHaveLength(1);
      expect(availabilityMap.size).toBe(1);
    });
  });
});
