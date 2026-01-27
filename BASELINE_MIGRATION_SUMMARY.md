# Baseline Migration Summary

## Overview
Created comprehensive baseline migration file `00000000000000_initial_schema.sql` that consolidates 197 individual migration files into a single foundational schema.

## File Location
```
/supabase/migrations/00000000000000_initial_schema.sql
```

## Statistics
- **Total Lines:** 2,675
- **Tables Created:** 45
- **RPC Functions:** 43
- **Indexes:** 125+
- **Sections:** 18

## What's Included

### Section 1-2: Extensions & Core User Tables
- `canonical_users` - Single source of truth for user data
- `users` - Legacy users table (backward compatibility)
- `profiles` - User profile information

### Section 3: Balance & Transaction Tables
- `sub_account_balances` - Modern balance tracking system
- `balance_ledger` - Complete audit trail of all balance changes
- `bonus_award_audit` - Track bonus awards
- `user_transactions` - User transaction history
- `wallet_balances_table_backup` - Legacy backup table

### Section 4: Competition Tables
- `competitions` - Main competition listings with VRF support
- `competition_entries` - Aggregated competition participation
- `_entries_progress` - Internal progress tracking

### Section 5: Ticket Tables
- `tickets` - Individual ticket records
- `tickets_sold` - Fast lookup for sold tickets
- `pending_tickets` - Temporary ticket reservations
- `pending_ticket_items` - Individual tickets in reservations

### Section 6: Winner & Prize Tables
- `winners` - Competition winner records
- `Prize_Instantprizes` - Instant win prizes

### Section 7: Order & Payment Tables
- `orders` - Order records
- `order_tickets` - Tickets associated with orders
- `payment_idempotency` - Prevent duplicate payments
- `payment_webhook_events` - External payment webhooks
- `payments_jobs` - Background payment processing
- `custody_transactions` - Custody provider transactions
- `internal_transfers` - Internal balance transfers
- `purchase_requests` - Purchase request tracking

### Section 8: Legacy Participation Tables
- `joincompetition` - Legacy join records
- `joined_competitions` - Another legacy participation table
- `participants` - Generic participants table

### Section 9: CMS & Content Tables
- `faqs` - Frequently asked questions
- `hero_competitions` - Featured homepage competitions
- `partners` - Partner/sponsor information
- `testimonials` - User testimonials
- `site_stats` - Platform statistics
- `site_metadata` - General site metadata
- `platform_statistics` - Detailed platform metrics

### Section 10: Notification Tables
- `notifications` - System notifications
- `user_notifications` - User-specific notifications

### Section 11: Admin Tables
- `admin_users` - Administrative user accounts
- `admin_sessions` - Admin session management
- `admin_users_audit` - Admin action audit log

### Section 12: Auth & Session Tables
- `email_auth_sessions` - Email authentication sessions

### Section 13: Event & Queue Tables
- `cdp_event_queue` - CDP event queue
- `enqueue_cdp_event` - Alternative CDP event table
- `confirmation_incident_log` - Incident logging

### Section 14: Internal Tracking
- `_payment_settings` - Internal payment configuration

### Section 15: Row Level Security (RLS)
- Enabled RLS on all tables
- Public read access for competitions and CMS content
- User-specific access for personal data
- Service role full access to all tables

### Section 16: RPC Functions (43 total)

**User Balance Functions (5):**
- `get_user_balance` - Get user balance from various sources
- `get_user_wallet_balance` - Alias for get_user_balance
- `credit_user_balance` - Credit balance to user
- `add_pending_balance` - Add pending balance for user
- `migrate_user_balance` - Migrate balance from old system

**Bonus & Credit Functions (3):**
- `credit_sub_account_balance` - Credit sub-account balance
- `credit_balance_with_first_deposit_bonus` - Credit with first deposit bonus
- `migrate_user_balance` - Balance migration helper

**User Profile & Wallet Management (12):**
- `upsert_canonical_user` - Create or update canonical user
- `update_user_profile_by_identifier` - Update user profile
- `update_user_avatar` - Update user avatar
- `attach_identity_after_auth` - Attach identity after auth
- `get_user_wallets` - Get user's wallets
- `link_additional_wallet` - Link additional wallet
- `unlink_wallet` - Unlink wallet
- `set_primary_wallet` - Set primary wallet
- `update_wallet_nickname` - Update wallet nickname
- `get_linked_external_wallet` - Get linked external wallet
- `unlink_external_wallet` - Unlink external wallet

**Ticket Reservation & Allocation (6):**
- `reserve_tickets` - Reserve specific tickets
- `reserve_tickets_atomically` - Reserve random tickets atomically
- `release_reservation` - Release ticket reservation
- `allocate_lucky_dip_tickets` - Allocate random tickets
- `allocate_lucky_dip_tickets_batch` - Batch allocation
- `finalize_order` - Finalize ticket purchase

**Competition Query Functions (6):**
- `get_unavailable_tickets` - Get unavailable ticket numbers
- `get_competition_unavailable_tickets` - Alias for above
- `get_available_ticket_count_v2` - Get available ticket count
- `check_and_mark_competition_sold_out` - Check if sold out
- `sync_competition_status_if_ended` - Update status if ended
- `get_competition_ticket_availability_text` - Get availability text
- `get_recent_entries_count` - Get recent entry count

**User Transaction & Entry Functions (7):**
- `get_user_transactions` - Get user transaction history
- `get_user_tickets` - Get user's tickets
- `get_user_tickets_for_competition` - Alias for above
- `get_user_active_tickets` - Get active tickets
- `get_competition_entries` - Get competition entry list
- `get_competition_entries_bypass_rls` - Same as above
- `get_competition_entries_public` - Public competition entries
- `get_user_competition_entries` - User's competition entries

**Dashboard Functions (1):**
- `get_comprehensive_user_dashboard_entries` - Complete dashboard data

**Payment Functions (1):**
- `execute_balance_payment` - Main payment processing RPC (simplified version)

**Helper Functions (2):**
- `log_confirmation_incident` - Log incidents
- `cleanup_expired_idempotency` - Clean up old records

### Section 17-18: Grants & Final Setup
- Execute permissions on all functions for anon, authenticated, service_role
- Additional indexes for performance
- Default privilege configuration

## Key Features

### 1. Multi-Wallet Support
- Users can link multiple wallets (Ethereum, Base, etc.)
- Primary wallet designation
- Wallet nicknames

### 2. Canonical User System
- Single source of truth for user data
- Replaces deprecated `privy_user_connections`
- Handles multiple user ID formats:
  - `prize:pid:0x...` (wallet format)
  - `did:privy:...` (Privy DID format)
  - UUIDs
  - Direct wallet addresses

### 3. Balance Tracking
- Primary: `sub_account_balances` table
- Fallback: `canonical_users.usdc_balance`
- Complete audit trail in `balance_ledger`
- Bonus balance support

### 4. VRF Integration
- `vrf_request_id` in competitions
- `vrf_transaction_hash` for verifiable draws
- `vrf_random_words` array for results
- `vrf_randomness` JSONB for full data

### 5. Payment Processing
- Idempotency support via `payment_idempotency` table
- Multiple payment providers
- Webhook event tracking
- Background job processing

### 6. Security
- Row Level Security (RLS) enabled on all tables
- Service role bypass for admin operations
- Public read access for non-sensitive data
- User-specific access for personal data

## Type Consistency

### ID Columns
- Most tables use `TEXT` for IDs (UUID cast to text)
- `canonical_user_id` is always TEXT
- `competition_id` can be TEXT or UUID (both supported)
- `enqueue_cdp_event` uses BIGSERIAL

### Status Values
Stored as TEXT (no SQL enums):
- Competition: `'upcoming'`, `'active'`, `'drawing'`, `'drawn'`, `'completed'`, `'cancelled'`, `'expired'`, `'draft'`, `'sold_out'`
- Payment: `'pending'`, `'waiting'`, `'confirmed'`, `'completed'`, `'failed'`, `'refunded'`, `'cancelled'`
- Reservation: `'pending'`, `'confirmed'`, `'expired'`, `'cancelled'`

## Testing Checklist

- [ ] Deploy to empty Supabase database
- [ ] Verify all 45 tables created
- [ ] Verify all 43 functions created
- [ ] Test key RPCs:
  - [ ] `get_user_balance`
  - [ ] `upsert_canonical_user`
  - [ ] `reserve_tickets`
  - [ ] `execute_balance_payment`
  - [ ] `get_comprehensive_user_dashboard_entries`
- [ ] Verify RLS policies work
- [ ] Test with sample data
- [ ] Check indexes are created
- [ ] Validate foreign key relationships

## Migration Path

### To Apply This Baseline
1. **New Database:** Just run this migration
2. **Existing Database:** 
   - Backup first!
   - This migration uses `IF NOT EXISTS` so it won't fail on existing tables
   - May need to compare schemas and reconcile differences
   - Consider running on a staging environment first

### Important Notes
- `execute_balance_payment` is simplified in this version
- For full implementation, see `20260123000000_godlike_balance_payment_rpc.sql`
- Some legacy tables kept for backward compatibility
- All tables use `IF NOT EXISTS` to prevent conflicts

## Next Steps

1. Test migration on development database
2. Verify all frontend operations work
3. Run security audit with CodeQL
4. Document any customizations needed
5. Plan migration strategy for production

## Version
- **Migration Version:** 1.0
- **Created:** 2026-01-27
- **Replaces:** 197 individual migration files
- **Compatibility:** Supabase PostgreSQL 15+

## Code Review Notes

### Policy Naming
The migration uses the same policy name "Service role full access" across multiple tables. This is **intentional and correct** in PostgreSQL, as policy names are scoped to their respective tables. Each table has its own policy namespace, so there are no naming conflicts.

For example:
```sql
CREATE POLICY "Service role full access" ON canonical_users ...
CREATE POLICY "Service role full access" ON users ...
```

These create distinct policies: `canonical_users."Service role full access"` and `users."Service role full access"`.

### RLS Enabling
The migration explicitly lists each `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` statement rather than using a loop. This is intentional for a baseline migration to:
1. Make the schema completely explicit and readable
2. Allow easy auditing of which tables have RLS enabled
3. Avoid complexity in the foundational migration file

