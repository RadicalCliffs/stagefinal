/**
 * Integration tests for getUserCompetitionEntries RPC
 * 
 * These tests verify that the getUserCompetitionEntries RPC function:
 * 1. Correctly calls the Supabase RPC with proper parameters
 * 2. Handles the response data structure including individual_purchases
 * 3. Properly transforms and returns data to the frontend
 * 4. Handles errors gracefully
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getUserCompetitionEntries } from '../supabase-rpc-helpers';
import type { UserCompetitionEntry } from '../../types/entries';

// Mock Supabase client
const createMockSupabaseClient = () => {
  return {
    rpc: vi.fn(),
  };
};

describe('getUserCompetitionEntries RPC Helper', () => {
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabaseClient();
    vi.clearAllMocks();
  });

  describe('Parameter Validation', () => {
    it('should throw error when userIdentifier is empty string', () => {
      expect(() => {
        getUserCompetitionEntries(mockSupabase, '');
      }).toThrow('userIdentifier is required for getUserCompetitionEntries');
    });

    it('should throw error when userIdentifier is whitespace only', () => {
      expect(() => {
        getUserCompetitionEntries(mockSupabase, '   ');
      }).toThrow('userIdentifier is required for getUserCompetitionEntries');
    });

    it('should throw error when userIdentifier is not provided', () => {
      expect(() => {
        getUserCompetitionEntries(mockSupabase, null as any);
      }).toThrow('userIdentifier is required for getUserCompetitionEntries');
    });
  });

  describe('RPC Call Structure', () => {
    it('should call Supabase RPC with correct function name and parameter', () => {
      const userIdentifier = 'prize:pid:0x1234567890';
      
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
      
      getUserCompetitionEntries(mockSupabase, userIdentifier);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('get_user_competition_entries', {
        p_user_identifier: userIdentifier
      });
    });

    it('should accept wallet address as identifier', () => {
      const walletAddress = '0x1234567890123456789012345678901234567890';
      
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
      
      getUserCompetitionEntries(mockSupabase, walletAddress);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('get_user_competition_entries', {
        p_user_identifier: walletAddress
      });
    });

    it('should accept canonical user ID as identifier', () => {
      const canonicalId = 'prize:pid:0x2137af5047526a1180';
      
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
      
      getUserCompetitionEntries(mockSupabase, canonicalId);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('get_user_competition_entries', {
        p_user_identifier: canonicalId
      });
    });

    it('should accept Privy DID as identifier', () => {
      const privyDid = 'did:privy:abc123';
      
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
      
      getUserCompetitionEntries(mockSupabase, privyDid);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('get_user_competition_entries', {
        p_user_identifier: privyDid
      });
    });
  });

  describe('Response Data Structure', () => {
    it('should handle empty results', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

      const result = await getUserCompetitionEntries(mockSupabase, 'test-user');

      expect(result).toEqual({ data: [], error: null });
    });

    it('should return entries with individual_purchases array', async () => {
      const mockEntry: UserCompetitionEntry = {
        id: 'entry-123',
        competition_id: 'comp-456',
        competition_title: 'Test Competition',
        competition_description: 'A test competition',
        competition_image_url: 'https://example.com/image.jpg',
        competition_status: 'active',
        competition_end_date: '2026-03-01T00:00:00Z',
        competition_prize_value: 1000,
        competition_is_instant_win: false,
        draw_date: '2026-03-01T12:00:00Z',
        vrf_tx_hash: null,
        vrf_status: null,
        vrf_draw_completed_at: null,
        tickets_count: 10,
        ticket_numbers: '1,2,3,4,5,6,7,8,9,10',
        amount_spent: '10.00',
        amount_paid: 10.0,
        is_winner: false,
        wallet_address: '0x1234567890123456789012345678901234567890',
        latest_purchase_at: '2026-02-14T10:00:00Z',
        created_at: '2026-02-10T08:00:00Z',
        entry_status: 'completed',
        individual_purchases: [
          {
            id: 'purchase-1',
            purchase_key: 'ut_trans-1',
            tickets_count: 5,
            amount_spent: 5.0,
            ticket_numbers: '1,2,3,4,5',
            purchased_at: '2026-02-10T08:00:00Z',
            created_at: '2026-02-10T08:00:00Z'
          },
          {
            id: 'purchase-2',
            purchase_key: 'ut_trans-2',
            tickets_count: 5,
            amount_spent: 5.0,
            ticket_numbers: '6,7,8,9,10',
            purchased_at: '2026-02-14T10:00:00Z',
            created_at: '2026-02-14T10:00:00Z'
          }
        ]
      };

      mockSupabase.rpc.mockResolvedValue({ data: [mockEntry], error: null });

      const result = await getUserCompetitionEntries(mockSupabase, 'test-user');

      expect(result.data).toHaveLength(1);
      expect(result.data![0]).toMatchObject({
        id: 'entry-123',
        competition_id: 'comp-456',
        tickets_count: 10,
        individual_purchases: expect.arrayContaining([
          expect.objectContaining({
            id: 'purchase-1',
            tickets_count: 5
          }),
          expect.objectContaining({
            id: 'purchase-2',
            tickets_count: 5
          })
        ])
      });
    });

    it('should handle entry with empty individual_purchases', async () => {
      const mockEntry: UserCompetitionEntry = {
        id: 'entry-789',
        competition_id: 'comp-456',
        competition_title: 'Test Competition',
        competition_description: null,
        competition_image_url: null,
        competition_status: 'active',
        competition_end_date: '2026-03-01T00:00:00Z',
        competition_prize_value: null,
        competition_is_instant_win: false,
        draw_date: null,
        vrf_tx_hash: null,
        vrf_status: null,
        vrf_draw_completed_at: null,
        tickets_count: 5,
        ticket_numbers: '1,2,3,4,5',
        amount_spent: '5.00',
        amount_paid: 5.0,
        is_winner: false,
        wallet_address: '0x1234567890123456789012345678901234567890',
        latest_purchase_at: '2026-02-10T08:00:00Z',
        created_at: '2026-02-10T08:00:00Z',
        entry_status: 'completed',
        individual_purchases: [] // Empty array
      };

      mockSupabase.rpc.mockResolvedValue({ data: [mockEntry], error: null });

      const result = await getUserCompetitionEntries(mockSupabase, 'test-user');

      expect(result.data).toHaveLength(1);
      expect(result.data![0].individual_purchases).toEqual([]);
    });

    it('should handle multiple entries with different payment providers', async () => {
      const mockEntries: UserCompetitionEntry[] = [
        {
          id: 'entry-1',
          competition_id: 'comp-1',
          competition_title: 'Competition 1',
          competition_description: null,
          competition_image_url: null,
          competition_status: 'active',
          competition_end_date: '2026-03-01T00:00:00Z',
          competition_prize_value: 500,
          competition_is_instant_win: false,
          draw_date: null,
          vrf_tx_hash: null,
          vrf_status: null,
          vrf_draw_completed_at: null,
          tickets_count: 3,
          ticket_numbers: '1,2,3',
          amount_spent: '3.00',
          amount_paid: 3.0,
          is_winner: false,
          wallet_address: '0x1234',
          latest_purchase_at: '2026-02-10T08:00:00Z',
          created_at: '2026-02-10T08:00:00Z',
          entry_status: 'completed',
          individual_purchases: [
            {
              id: 'purchase-base-1',
              purchase_key: 'ut_trans-base-1',
              tickets_count: 3,
              amount_spent: 3.0,
              ticket_numbers: '1,2,3',
              purchased_at: '2026-02-10T08:00:00Z',
              created_at: '2026-02-10T08:00:00Z'
            }
          ]
        },
        {
          id: 'entry-2',
          competition_id: 'comp-2',
          competition_title: 'Competition 2',
          competition_description: null,
          competition_image_url: null,
          competition_status: 'active',
          competition_end_date: '2026-03-15T00:00:00Z',
          competition_prize_value: 1000,
          competition_is_instant_win: false,
          draw_date: null,
          vrf_tx_hash: null,
          vrf_status: null,
          vrf_draw_completed_at: null,
          tickets_count: 5,
          ticket_numbers: '10,11,12,13,14',
          amount_spent: '5.00',
          amount_paid: 5.0,
          is_winner: false,
          wallet_address: '0x1234',
          latest_purchase_at: '2026-02-11T09:00:00Z',
          created_at: '2026-02-11T09:00:00Z',
          entry_status: 'completed',
          individual_purchases: [
            {
              id: 'purchase-balance-1',
              purchase_key: 'ut_trans-balance-1',
              tickets_count: 5,
              amount_spent: 5.0,
              ticket_numbers: '10,11,12,13,14',
              purchased_at: '2026-02-11T09:00:00Z',
              created_at: '2026-02-11T09:00:00Z'
            }
          ]
        }
      ];

      mockSupabase.rpc.mockResolvedValue({ data: mockEntries, error: null });

      const result = await getUserCompetitionEntries(mockSupabase, 'test-user');

      expect(result.data).toHaveLength(2);
      expect(result.data![0].competition_id).toBe('comp-1');
      expect(result.data![1].competition_id).toBe('comp-2');
      expect(result.data![0].individual_purchases).toHaveLength(1);
      expect(result.data![1].individual_purchases).toHaveLength(1);
    });
  });

  describe('Individual Purchases Data Integrity', () => {
    it('should preserve all individual purchase fields', async () => {
      const mockEntry: UserCompetitionEntry = {
        id: 'entry-123',
        competition_id: 'comp-456',
        competition_title: 'Test Competition',
        competition_description: null,
        competition_image_url: null,
        competition_status: 'active',
        competition_end_date: '2026-03-01T00:00:00Z',
        competition_prize_value: null,
        competition_is_instant_win: false,
        draw_date: null,
        vrf_tx_hash: null,
        vrf_status: null,
        vrf_draw_completed_at: null,
        tickets_count: 10,
        ticket_numbers: '1,2,3,4,5,6,7,8,9,10',
        amount_spent: '10.00',
        amount_paid: 10.0,
        is_winner: false,
        wallet_address: '0x1234',
        latest_purchase_at: '2026-02-14T10:00:00Z',
        created_at: '2026-02-10T08:00:00Z',
        entry_status: 'completed',
        individual_purchases: [
          {
            id: 'purchase-1',
            purchase_key: 'ut_trans-1',
            tickets_count: 10,
            amount_spent: 10.0,
            ticket_numbers: '1,2,3,4,5,6,7,8,9,10',
            purchased_at: '2026-02-14T10:00:00Z',
            created_at: '2026-02-14T10:00:00Z'
          }
        ]
      };

      mockSupabase.rpc.mockResolvedValue({ data: [mockEntry], error: null });

      const result = await getUserCompetitionEntries(mockSupabase, 'test-user');

      const purchase = result.data![0].individual_purchases[0];
      expect(purchase).toEqual({
        id: 'purchase-1',
        purchase_key: 'ut_trans-1',
        tickets_count: 10,
        amount_spent: 10.0,
        ticket_numbers: '1,2,3,4,5,6,7,8,9,10',
        purchased_at: '2026-02-14T10:00:00Z',
        created_at: '2026-02-14T10:00:00Z'
      });
    });

    it('should correctly aggregate individual purchases into entry totals', async () => {
      const mockEntry: UserCompetitionEntry = {
        id: 'entry-123',
        competition_id: 'comp-456',
        competition_title: 'Test Competition',
        competition_description: null,
        competition_image_url: null,
        competition_status: 'active',
        competition_end_date: '2026-03-01T00:00:00Z',
        competition_prize_value: null,
        competition_is_instant_win: false,
        draw_date: null,
        vrf_tx_hash: null,
        vrf_status: null,
        vrf_draw_completed_at: null,
        tickets_count: 15,
        ticket_numbers: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15',
        amount_spent: '15.00',
        amount_paid: 15.0,
        is_winner: false,
        wallet_address: '0x1234',
        latest_purchase_at: '2026-02-14T10:00:00Z',
        created_at: '2026-02-10T08:00:00Z',
        entry_status: 'completed',
        individual_purchases: [
          {
            id: 'purchase-1',
            purchase_key: 'ut_trans-1',
            tickets_count: 5,
            amount_spent: 5.0,
            ticket_numbers: '1,2,3,4,5',
            purchased_at: '2026-02-10T08:00:00Z',
            created_at: '2026-02-10T08:00:00Z'
          },
          {
            id: 'purchase-2',
            purchase_key: 'ut_trans-2',
            tickets_count: 10,
            amount_spent: 10.0,
            ticket_numbers: '6,7,8,9,10,11,12,13,14,15',
            purchased_at: '2026-02-14T10:00:00Z',
            created_at: '2026-02-14T10:00:00Z'
          }
        ]
      };

      mockSupabase.rpc.mockResolvedValue({ data: [mockEntry], error: null });

      const result = await getUserCompetitionEntries(mockSupabase, 'test-user');

      const entry = result.data![0];
      
      // Verify aggregated totals match sum of individual purchases
      const totalTickets = entry.individual_purchases.reduce(
        (sum: any, p: any) => sum + p.tickets_count, 0
      );
      const totalAmount = entry.individual_purchases.reduce(
        (sum: any, p: any) => sum + p.amount_spent, 0
      );

      expect(entry.tickets_count).toBe(totalTickets);
      expect(Number(entry.amount_spent)).toBe(totalAmount);
    });
  });

  describe('Error Handling', () => {
    it('should return error when RPC fails', async () => {
      const mockError = { message: 'RPC function not found', code: '42883' };
      
      mockSupabase.rpc.mockResolvedValue({ data: null, error: mockError });

      const result = await getUserCompetitionEntries(mockSupabase, 'test-user');

      expect(result.error).toEqual(mockError);
      expect(result.data).toBeNull();
    });

    it('should return error when database connection fails', async () => {
      const mockError = { message: 'Connection timeout', code: 'TIMEOUT' };
      
      mockSupabase.rpc.mockResolvedValue({ data: null, error: mockError });

      const result = await getUserCompetitionEntries(mockSupabase, 'test-user');

      expect(result.error).toEqual(mockError);
    });

    it('should handle network errors', async () => {
      const mockError = { message: 'Network error', code: 'NETWORK_ERROR' };
      
      mockSupabase.rpc.mockResolvedValue({ data: null, error: mockError });

      const result = await getUserCompetitionEntries(mockSupabase, 'test-user');

      expect(result.error).toEqual(mockError);
    });
  });

  describe('Draw Information', () => {
    it('should include VRF draw information when available', async () => {
      const mockEntry: UserCompetitionEntry = {
        id: 'entry-123',
        competition_id: 'comp-456',
        competition_title: 'Drawn Competition',
        competition_description: null,
        competition_image_url: null,
        competition_status: 'completed',
        competition_end_date: '2026-02-01T00:00:00Z',
        competition_prize_value: 1000,
        competition_is_instant_win: false,
        draw_date: '2026-02-01T12:00:00Z',
        vrf_tx_hash: '0xabc123def456',
        vrf_status: 'completed',
        vrf_draw_completed_at: '2026-02-01T12:05:00Z',
        tickets_count: 10,
        ticket_numbers: '1,2,3,4,5,6,7,8,9,10',
        amount_spent: '10.00',
        amount_paid: 10.0,
        is_winner: true,
        wallet_address: '0x1234',
        latest_purchase_at: '2026-01-20T10:00:00Z',
        created_at: '2026-01-20T10:00:00Z',
        entry_status: 'completed',
        individual_purchases: []
      };

      mockSupabase.rpc.mockResolvedValue({ data: [mockEntry], error: null });

      const result = await getUserCompetitionEntries(mockSupabase, 'test-user');

      const entry = result.data![0];
      expect(entry.vrf_tx_hash).toBe('0xabc123def456');
      expect(entry.vrf_status).toBe('completed');
      expect(entry.vrf_draw_completed_at).toBe('2026-02-01T12:05:00Z');
      expect(entry.is_winner).toBe(true);
    });

    it('should handle pending draw status', async () => {
      const mockEntry: UserCompetitionEntry = {
        id: 'entry-123',
        competition_id: 'comp-456',
        competition_title: 'Drawing Competition',
        competition_description: null,
        competition_image_url: null,
        competition_status: 'drawing',
        competition_end_date: '2026-02-15T00:00:00Z',
        competition_prize_value: 500,
        competition_is_instant_win: false,
        draw_date: '2026-02-15T12:00:00Z',
        vrf_tx_hash: '0xpending',
        vrf_status: 'pending',
        vrf_draw_completed_at: null,
        tickets_count: 5,
        ticket_numbers: '100,101,102,103,104',
        amount_spent: '5.00',
        amount_paid: 5.0,
        is_winner: false,
        wallet_address: '0x1234',
        latest_purchase_at: '2026-02-10T10:00:00Z',
        created_at: '2026-02-10T10:00:00Z',
        entry_status: 'completed',
        individual_purchases: []
      };

      mockSupabase.rpc.mockResolvedValue({ data: [mockEntry], error: null });

      const result = await getUserCompetitionEntries(mockSupabase, 'test-user');

      const entry = result.data![0];
      expect(entry.vrf_status).toBe('pending');
      expect(entry.vrf_draw_completed_at).toBeNull();
      expect(entry.is_winner).toBe(false);
    });
  });
});
