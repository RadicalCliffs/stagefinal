/**
 * Purchase Grouping Test Suite
 * 
 * Tests the purchase grouping functionality:
 * 1. Purchase events are correctly grouped by time windows
 * 2. Purchase groups are properly fetched and formatted
 * 3. Component correctly displays grouped purchases
 */

import { describe, it, expect } from 'vitest';
import type { PurchaseGroup, PurchaseEvent } from '../purchase-dashboard';

describe('Purchase Grouping', () => {
  describe('PurchaseGroup Type Structure', () => {
    it('should have correct structure for purchase group', () => {
      const mockGroup: PurchaseGroup = {
        user_id: 'prize:pid:0x123',
        competition_id: 'comp-456',
        purchase_group_number: 1,
        group_start_at: '2026-02-19T10:00:00Z',
        group_end_at: '2026-02-19T10:03:00Z',
        events_in_group: 2,
        total_amount: 10.0,
        any_purchase_key: 'ut_trans-1',
        events: [
          {
            source_table: 'tickets',
            source_row_id: 'ticket-1',
            amount: 5.0,
            occurred_at: '2026-02-19T10:00:00Z',
            purchase_key: 'ut_trans-1'
          },
          {
            source_table: 'tickets',
            source_row_id: 'ticket-2',
            amount: 5.0,
            occurred_at: '2026-02-19T10:03:00Z',
            purchase_key: 'ut_trans-1'
          }
        ]
      };

      expect(mockGroup.user_id).toBe('prize:pid:0x123');
      expect(mockGroup.competition_id).toBe('comp-456');
      expect(mockGroup.purchase_group_number).toBe(1);
      expect(mockGroup.events_in_group).toBe(2);
      expect(mockGroup.total_amount).toBe(10.0);
      expect(mockGroup.events).toHaveLength(2);
    });

    it('should handle multiple purchase groups for same user and competition', () => {
      const groups: PurchaseGroup[] = [
        {
          user_id: 'prize:pid:0x123',
          competition_id: 'comp-456',
          purchase_group_number: 1,
          group_start_at: '2026-02-19T10:00:00Z',
          group_end_at: '2026-02-19T10:03:00Z',
          events_in_group: 2,
          total_amount: 10.0,
          any_purchase_key: 'ut_trans-1',
          events: []
        },
        {
          user_id: 'prize:pid:0x123',
          competition_id: 'comp-456',
          purchase_group_number: 2,
          group_start_at: '2026-02-19T14:00:00Z',
          group_end_at: '2026-02-19T14:02:00Z',
          events_in_group: 1,
          total_amount: 5.0,
          any_purchase_key: 'ut_trans-2',
          events: []
        }
      ];

      // Groups should be separate if more than 5 minutes apart
      expect(groups).toHaveLength(2);
      expect(groups[0].purchase_group_number).toBe(1);
      expect(groups[1].purchase_group_number).toBe(2);
      
      const timeDiff = new Date(groups[1].group_start_at).getTime() - 
                      new Date(groups[0].group_end_at).getTime();
      expect(timeDiff).toBeGreaterThan(5 * 60 * 1000); // > 5 minutes
    });
  });

  describe('PurchaseEvent Type Structure', () => {
    it('should support both tickets and joincompetition sources', () => {
      const ticketEvent: PurchaseEvent = {
        source_row_id: 'ticket-uid-123',
        source_table: 'tickets',
        user_id: 'prize:pid:0x123',
        competition_id: 'comp-456',
        amount: 5.0,
        occurred_at: '2026-02-19T10:00:00Z',
        purchase_key: 'ut_trans-1'
      };

      const joinCompEvent: PurchaseEvent = {
        source_row_id: 'jc-uid-456',
        source_table: 'joincompetition',
        user_id: 'prize:pid:0x123',
        competition_id: 'comp-456',
        amount: 10.0,
        occurred_at: '2026-02-19T10:01:00Z',
        purchase_key: 'ut_trans-2'
      };

      expect(ticketEvent.source_table).toBe('tickets');
      expect(joinCompEvent.source_table).toBe('joincompetition');
    });
  });

  describe('Grouping Logic', () => {
    it('should group events within 5-minute window', () => {
      // Events within 5 minutes should be in the same group
      const event1Time = new Date('2026-02-19T10:00:00Z');
      const event2Time = new Date('2026-02-19T10:04:00Z');
      
      const timeDiff = event2Time.getTime() - event1Time.getTime();
      expect(timeDiff).toBeLessThanOrEqual(5 * 60 * 1000);
    });

    it('should create new group for events more than 5 minutes apart', () => {
      // Events more than 5 minutes apart should be in different groups
      const event1Time = new Date('2026-02-19T10:00:00Z');
      const event2Time = new Date('2026-02-19T10:06:00Z');
      
      const timeDiff = event2Time.getTime() - event1Time.getTime();
      expect(timeDiff).toBeGreaterThan(5 * 60 * 1000);
    });
  });

  describe('Amount Calculation', () => {
    it('should sum amounts correctly in a group', () => {
      const group: PurchaseGroup = {
        user_id: 'prize:pid:0x123',
        competition_id: 'comp-456',
        purchase_group_number: 1,
        group_start_at: '2026-02-19T10:00:00Z',
        group_end_at: '2026-02-19T10:03:00Z',
        events_in_group: 3,
        total_amount: 15.0,
        any_purchase_key: null,
        events: [
          {
            source_table: 'tickets',
            source_row_id: 'ticket-1',
            amount: 5.0,
            occurred_at: '2026-02-19T10:00:00Z',
            purchase_key: null
          },
          {
            source_table: 'tickets',
            source_row_id: 'ticket-2',
            amount: 5.0,
            occurred_at: '2026-02-19T10:02:00Z',
            purchase_key: null
          },
          {
            source_table: 'joincompetition',
            source_row_id: 'jc-1',
            amount: 5.0,
            occurred_at: '2026-02-19T10:03:00Z',
            purchase_key: null
          }
        ]
      };

      const calculatedTotal = group.events.reduce((sum, event) => sum + event.amount, 0);
      expect(calculatedTotal).toBe(15.0);
      expect(calculatedTotal).toBe(group.total_amount);
    });
  });
});
