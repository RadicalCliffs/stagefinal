-- ============================================================================
-- FRONTEND-FIRST BASELINE MIGRATION
-- ============================================================================
-- This migration creates the complete database schema required by the frontend
-- Disregards all existing migrations and focuses on what the frontend actually needs
-- 
-- Created: 2026-02-08
-- Purpose: Clean baseline migration built from frontend requirements
-- 
-- Includes:
-- - Core user authentication tables
-- - Competition and ticket management
-- - Balance and payment tracking
-- - Content management (CMS)
-- - All RPC functions required by frontend
-- - All views required by frontend
-- - RLS policies for security
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- SECTION 2: CORE USER TABLES
-- ============================================================================

-- canonical_users: Single source of truth for all user identities
-- Supports multiple auth methods: email, wallet, Privy
CREATE TABLE IF NOT EXISTS canonical_users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  canonical_user_id TEXT UNIQUE NOT NULL DEFAULT ('prize:pid:' || gen_random_uuid()::text),
  uid TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  
  -- Auth identifiers
  privy_user_id TEXT UNIQUE,
  email TEXT,
  wallet_address TEXT,
  base_wallet_address TEXT,
  eth_wallet_address TEXT,
  smart_wallet_address TEXT,
  primary_wallet_address TEXT,
  
  -- Profile fields
  username TEXT,
  avatar_url TEXT,
  country TEXT,
  first_name TEXT,
  last_name TEXT,
  telegram_handle TEXT,
  telephone_number TEXT,
  
  -- Balance fields (legacy - kept for backward compatibility)
  usdc_balance NUMERIC(20, 6) DEFAULT 0 NOT NULL,
  bonus_balance NUMERIC(20, 6) DEFAULT 0 NOT NULL,
  has_used_new_user_bonus BOOLEAN DEFAULT false NOT NULL,
  
  -- Metadata
  auth_provider TEXT,
  wallet_linked TEXT,
  linked_wallets JSONB DEFAULT '[]'::jsonb,
  is_admin BOOLEAN DEFAULT false NOT NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_canonical_users_canonical_user_id ON canonical_users(canonical_user_id);
CREATE INDEX idx_canonical_users_uid ON canonical_users(uid);
CREATE INDEX idx_canonical_users_privy_user_id ON canonical_users(privy_user_id);
CREATE INDEX idx_canonical_users_wallet_address ON canonical_users(LOWER(wallet_address));
CREATE INDEX idx_canonical_users_base_wallet_address ON canonical_users(LOWER(base_wallet_address));
CREATE INDEX idx_canonical_users_eth_wallet_address ON canonical_users(LOWER(eth_wallet_address));
CREATE INDEX idx_canonical_users_email ON canonical_users(LOWER(email));
CREATE INDEX idx_canonical_users_smart_wallet ON canonical_users(LOWER(smart_wallet_address));

-- Legacy users table (kept for backward compatibility)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT UNIQUE,
  wallet_address TEXT,
  username TEXT,
  email TEXT,
  telegram_handle TEXT,
  telephone_number TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_wallet_address ON users(LOWER(wallet_address));
CREATE INDEX idx_users_user_id ON users(user_id);

-- profiles: User profile information (legacy)
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT,
  username TEXT,
  email TEXT,
  wallet_address TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_profiles_user_id ON profiles(user_id);
CREATE INDEX idx_profiles_wallet_address ON profiles(LOWER(wallet_address));

-- ============================================================================
-- SECTION 3: BALANCE & TRANSACTION TABLES
-- ============================================================================

-- sub_account_balances: Per-currency wallet balances for each user
CREATE TABLE IF NOT EXISTS sub_account_balances (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  canonical_user_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  available_balance NUMERIC(20, 6) DEFAULT 0 NOT NULL,
  pending_balance NUMERIC(20, 6) DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(canonical_user_id, currency)
);

CREATE INDEX idx_sub_account_balances_canonical_user_id ON sub_account_balances(canonical_user_id);
CREATE INDEX idx_sub_account_balances_currency ON sub_account_balances(currency);

-- wallet_balances: View-like table for balance queries
-- This serves as a compatibility layer for the user_overview view
CREATE TABLE IF NOT EXISTS wallet_balances (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  canonical_user_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  available_balance NUMERIC(20, 6) DEFAULT 0 NOT NULL,
  pending_balance NUMERIC(20, 6) DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(canonical_user_id, currency)
);

CREATE INDEX idx_wallet_balances_canonical_user_id ON wallet_balances(canonical_user_id);
CREATE INDEX idx_wallet_balances_currency ON wallet_balances(currency);

-- wallet_ledger: Complete transaction history with before/after balances
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  canonical_user_id TEXT NOT NULL,
  reference_id TEXT,
  transaction_type TEXT NOT NULL,
  amount NUMERIC(20, 6) NOT NULL,
  currency TEXT DEFAULT 'USD' NOT NULL,
  balance_before NUMERIC(20, 6),
  balance_after NUMERIC(20, 6),
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_wallet_ledger_canonical_user_id ON wallet_ledger(canonical_user_id);
CREATE INDEX idx_wallet_ledger_reference_id ON wallet_ledger(reference_id);
CREATE INDEX idx_wallet_ledger_transaction_type ON wallet_ledger(transaction_type);
CREATE INDEX idx_wallet_ledger_created_at ON wallet_ledger(created_at DESC);

-- balance_ledger: Audit trail for all balance changes
CREATE TABLE IF NOT EXISTS balance_ledger (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  canonical_user_id TEXT NOT NULL,
  reference_id TEXT,
  transaction_type TEXT NOT NULL,
  amount NUMERIC(20, 6) NOT NULL,
  currency TEXT DEFAULT 'USD' NOT NULL,
  balance_before NUMERIC(20, 6),
  balance_after NUMERIC(20, 6),
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_balance_ledger_canonical_user_id ON balance_ledger(canonical_user_id);
CREATE INDEX idx_balance_ledger_reference_id ON balance_ledger(reference_id);
CREATE INDEX idx_balance_ledger_transaction_type ON balance_ledger(transaction_type);
CREATE INDEX idx_balance_ledger_created_at ON balance_ledger(created_at DESC);

-- bonus_award_audit: Track bonus awards
CREATE TABLE IF NOT EXISTS bonus_award_audit (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  canonical_user_id TEXT NOT NULL,
  bonus_type TEXT NOT NULL,
  amount NUMERIC(20, 6) NOT NULL,
  currency TEXT DEFAULT 'USD' NOT NULL,
  awarded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  metadata JSONB
);

CREATE INDEX idx_bonus_award_audit_canonical_user_id ON bonus_award_audit(canonical_user_id);
CREATE INDEX idx_bonus_award_audit_bonus_type ON bonus_award_audit(bonus_type);

-- user_transactions: All user transactions (deposits, withdrawals, purchases)
CREATE TABLE IF NOT EXISTS user_transactions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  canonical_user_id TEXT NOT NULL,
  user_id TEXT,
  wallet_address TEXT,
  
  transaction_type TEXT NOT NULL,
  amount NUMERIC(20, 6) NOT NULL,
  currency TEXT DEFAULT 'USD' NOT NULL,
  
  status TEXT DEFAULT 'pending' NOT NULL,
  payment_provider TEXT,
  transaction_hash TEXT,
  payment_intent_id TEXT,
  
  competition_id TEXT,
  ticket_count INTEGER,
  
  description TEXT,
  metadata JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_user_transactions_canonical_user_id ON user_transactions(canonical_user_id);
CREATE INDEX idx_user_transactions_user_id ON user_transactions(user_id);
CREATE INDEX idx_user_transactions_wallet_address ON user_transactions(LOWER(wallet_address));
CREATE INDEX idx_user_transactions_transaction_type ON user_transactions(transaction_type);
CREATE INDEX idx_user_transactions_status ON user_transactions(status);
CREATE INDEX idx_user_transactions_competition_id ON user_transactions(competition_id);
CREATE INDEX idx_user_transactions_created_at ON user_transactions(created_at DESC);

-- pending_topups: Pending balance top-ups waiting for confirmation
CREATE TABLE IF NOT EXISTS pending_topups (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  canonical_user_id TEXT NOT NULL,
  amount NUMERIC(20, 6) NOT NULL,
  currency TEXT DEFAULT 'USD' NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL,
  payment_provider TEXT,
  payment_intent_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX idx_pending_topups_canonical_user_id ON pending_topups(canonical_user_id);
CREATE INDEX idx_pending_topups_status ON pending_topups(status);

-- ============================================================================
-- SECTION 4: COMPETITION TABLES
-- ============================================================================

-- competitions: Main competition listings
CREATE TABLE IF NOT EXISTS competitions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  uid TEXT UNIQUE,
  creator_id TEXT,
  
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  
  prize_type TEXT NOT NULL,
  prize_value TEXT NOT NULL,
  
  ticket_price NUMERIC(10, 2) DEFAULT 0.99 NOT NULL,
  total_tickets INTEGER NOT NULL,
  -- Note: Both sold_tickets and tickets_sold kept for backward compatibility with frontend
  -- They should be kept in sync. Consider consolidating in future migration.
  sold_tickets INTEGER DEFAULT 0 NOT NULL,
  tickets_sold INTEGER DEFAULT 0 NOT NULL,
  max_tickets INTEGER,
  max_participants INTEGER,
  
  status TEXT DEFAULT 'active' NOT NULL,
  competition_type TEXT,
  
  start_time TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  start_date TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  draw_date TIMESTAMPTZ,
  drawn_at TIMESTAMPTZ,
  
  is_instant_win BOOLEAN DEFAULT false,
  is_featured BOOLEAN DEFAULT false,
  winning_tickets_generated BOOLEAN DEFAULT false,
  
  winner_address TEXT,
  tx_hash TEXT,
  vrf_request_id TEXT,
  
  -- VRF On-Chain fields for provably fair draws
  onchain_competition_id INTEGER,
  vrf_error TEXT,
  vrf_draw_requested_at TIMESTAMPTZ,
  
  -- Contract integration
  contract_address TEXT,
  chain_id INTEGER,
  
  -- SEO metadata
  metadata_title TEXT,
  metadata_description TEXT,
  metadata_image TEXT,
  
  -- Display customization
  font_size_override TEXT,
  font_weight_override TEXT,
  category TEXT,
  
  -- Legacy fields
  entry_fee TEXT,
  entry_price NUMERIC(10, 2),
  total_entries INTEGER,
  entries_sold INTEGER,
  competitionended INTEGER,
  crdate TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_competitions_status ON competitions(status);
CREATE INDEX idx_competitions_uid ON competitions(uid);
CREATE INDEX idx_competitions_creator_id ON competitions(creator_id);
CREATE INDEX idx_competitions_is_instant_win ON competitions(is_instant_win);
CREATE INDEX idx_competitions_is_featured ON competitions(is_featured);
CREATE INDEX idx_competitions_end_date ON competitions(end_date);
CREATE INDEX idx_competitions_category ON competitions(category);
CREATE INDEX idx_competitions_sold_tickets ON competitions(sold_tickets);

-- competition_entries: Finalized entries for competitions
CREATE TABLE IF NOT EXISTS competition_entries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  competition_id TEXT NOT NULL,
  
  canonical_user_id TEXT,
  user_id TEXT,
  wallet_address TEXT,
  
  ticket_numbers INTEGER[],
  ticket_count INTEGER DEFAULT 0 NOT NULL,
  
  amount_paid NUMERIC(20, 6) NOT NULL,
  currency TEXT DEFAULT 'USD' NOT NULL,
  
  transaction_hash TEXT,
  payment_provider TEXT,
  
  entry_status TEXT DEFAULT 'active' NOT NULL,
  is_winner BOOLEAN DEFAULT false,
  prize_claimed BOOLEAN DEFAULT false,
  
  competition_title TEXT,
  competition_description TEXT,
  competition_image_url TEXT,
  competition_status TEXT,
  competition_end_date TIMESTAMPTZ,
  competition_prize_value NUMERIC(20, 2),
  competition_is_instant_win BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_competition_entries_competition_id ON competition_entries(competition_id);
CREATE INDEX idx_competition_entries_canonical_user_id ON competition_entries(canonical_user_id);
CREATE INDEX idx_competition_entries_user_id ON competition_entries(user_id);
CREATE INDEX idx_competition_entries_wallet_address ON competition_entries(LOWER(wallet_address));
CREATE INDEX idx_competition_entries_entry_status ON competition_entries(entry_status);
CREATE INDEX idx_competition_entries_is_winner ON competition_entries(is_winner);

-- tickets: Individual ticket records
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  competition_id TEXT NOT NULL,
  ticket_number INTEGER NOT NULL,
  
  canonical_user_id TEXT,
  user_id TEXT,
  wallet_address TEXT,
  
  status TEXT DEFAULT 'available' NOT NULL,
  is_winner BOOLEAN DEFAULT false,
  
  -- Note: Both payment_tx_hash and tx_id kept for backward compatibility
  -- payment_tx_hash: Direct payment transaction hash (crypto payments)
  -- tx_id: Internal transaction/order ID reference
  payment_tx_hash TEXT,
  tx_id TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  purchased_at TIMESTAMPTZ,
  
  UNIQUE(competition_id, ticket_number)
);

CREATE INDEX idx_tickets_competition_id ON tickets(competition_id);
CREATE INDEX idx_tickets_canonical_user_id ON tickets(canonical_user_id);
CREATE INDEX idx_tickets_user_id ON tickets(user_id);
CREATE INDEX idx_tickets_wallet_address ON tickets(LOWER(wallet_address));
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_ticket_number ON tickets(ticket_number);
CREATE INDEX idx_tickets_is_winner ON tickets(is_winner);
CREATE INDEX idx_tickets_competition_user ON tickets(competition_id, canonical_user_id);

-- tickets_sold: Legacy table for sold tickets tracking
CREATE TABLE IF NOT EXISTS tickets_sold (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  competition_id TEXT NOT NULL,
  ticket_number INTEGER NOT NULL,
  user_id TEXT,
  sold_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tickets_sold_competition_id ON tickets_sold(competition_id);
CREATE INDEX idx_tickets_sold_user_id ON tickets_sold(user_id);

-- pending_tickets: Temporary ticket reservations during checkout
CREATE TABLE IF NOT EXISTS pending_tickets (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  reservation_id TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  
  competition_id TEXT NOT NULL,
  canonical_user_id TEXT,
  user_id TEXT,
  wallet_address TEXT,
  
  ticket_count INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL,
  
  transaction_hash TEXT,
  client_secret TEXT,
  payment_intent_id TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX idx_pending_tickets_competition_id ON pending_tickets(competition_id);
CREATE INDEX idx_pending_tickets_canonical_user_id ON pending_tickets(canonical_user_id);
CREATE INDEX idx_pending_tickets_user_id ON pending_tickets(user_id);
CREATE INDEX idx_pending_tickets_wallet_address ON pending_tickets(LOWER(wallet_address));
CREATE INDEX idx_pending_tickets_status ON pending_tickets(status);
CREATE INDEX idx_pending_tickets_expires_at ON pending_tickets(expires_at);

-- pending_ticket_items: Individual ticket numbers in a reservation
CREATE TABLE IF NOT EXISTS pending_ticket_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  pending_ticket_id TEXT NOT NULL,
  competition_id TEXT NOT NULL,
  ticket_number INTEGER NOT NULL,
  status TEXT DEFAULT 'reserved' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(competition_id, ticket_number, pending_ticket_id)
);

CREATE INDEX idx_pending_ticket_items_pending_ticket_id ON pending_ticket_items(pending_ticket_id);
CREATE INDEX idx_pending_ticket_items_competition_id ON pending_ticket_items(competition_id);
CREATE INDEX idx_pending_ticket_items_ticket_number ON pending_ticket_items(ticket_number);

-- joincompetition: Legacy join records (CRITICAL for v_joincompetition_active view)
CREATE TABLE IF NOT EXISTS joincompetition (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  userid TEXT NOT NULL,
  competitionid TEXT NOT NULL,
  wallet_address TEXT,
  ticketnumbers INTEGER[],
  purchasedate TIMESTAMPTZ DEFAULT NOW(),
  joinedat TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

CREATE INDEX idx_joincompetition_userid ON joincompetition(userid);
CREATE INDEX idx_joincompetition_competitionid ON joincompetition(competitionid);
CREATE INDEX idx_joincompetition_wallet_address ON joincompetition(LOWER(wallet_address));
CREATE INDEX idx_joincompetition_is_active ON joincompetition(is_active);

-- ============================================================================
-- SECTION 5: WINNER TABLES
-- ============================================================================

-- winners: Main winners table
CREATE TABLE IF NOT EXISTS winners (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  competition_id TEXT NOT NULL,
  
  canonical_user_id TEXT,
  user_id TEXT,
  wallet_address TEXT,
  username TEXT,
  
  winning_ticket_number INTEGER,
  prize_value TEXT,
  
  won_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  claimed_at TIMESTAMPTZ,
  
  transaction_hash TEXT,
  vrf_hash TEXT,
  
  country TEXT,
  avatar_url TEXT,
  
  is_instant_win BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_winners_competition_id ON winners(competition_id);
CREATE INDEX idx_winners_canonical_user_id ON winners(canonical_user_id);
CREATE INDEX idx_winners_user_id ON winners(user_id);
CREATE INDEX idx_winners_wallet_address ON winners(LOWER(wallet_address));
CREATE INDEX idx_winners_won_at ON winners(won_at DESC);

-- competition_winners: Alternative winners table
CREATE TABLE IF NOT EXISTS competition_winners (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  competition_id TEXT NOT NULL,
  canonical_user_id TEXT,
  user_id TEXT,
  wallet_address TEXT,
  winning_ticket_number INTEGER,
  won_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_competition_winners_competition_id ON competition_winners(competition_id);
CREATE INDEX idx_competition_winners_canonical_user_id ON competition_winners(canonical_user_id);

-- Prize_Instantprizes: Instant win prize configuration
CREATE TABLE IF NOT EXISTS "Prize_Instantprizes" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  uid TEXT UNIQUE,
  prize_name TEXT NOT NULL,
  prize_value TEXT,
  ticket_number INTEGER,
  competition_id TEXT,
  is_claimed BOOLEAN DEFAULT false,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_Prize_Instantprizes_competition_id ON "Prize_Instantprizes"(competition_id);
CREATE INDEX idx_Prize_Instantprizes_is_claimed ON "Prize_Instantprizes"(is_claimed);
CREATE INDEX idx_Prize_Instantprizes_uid ON "Prize_Instantprizes"(uid);

-- ============================================================================
-- SECTION 6: ORDER & PAYMENT TABLES
-- ============================================================================

-- orders: Purchase orders
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  
  canonical_user_id TEXT,
  user_id TEXT,
  wallet_address TEXT,
  
  competition_id TEXT NOT NULL,
  ticket_count INTEGER NOT NULL,
  
  total_amount NUMERIC(20, 6) NOT NULL,
  currency TEXT DEFAULT 'USD' NOT NULL,
  
  status TEXT DEFAULT 'pending' NOT NULL,
  payment_provider TEXT,
  transaction_hash TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_orders_canonical_user_id ON orders(canonical_user_id);
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_wallet_address ON orders(LOWER(wallet_address));
CREATE INDEX idx_orders_competition_id ON orders(competition_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_order_id ON orders(order_id);

-- order_tickets: Tickets associated with orders
CREATE TABLE IF NOT EXISTS order_tickets (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  order_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_tickets_order_id ON order_tickets(order_id);
CREATE INDEX idx_order_tickets_ticket_id ON order_tickets(ticket_id);

-- payment_idempotency: Prevent duplicate payments
CREATE TABLE IF NOT EXISTS payment_idempotency (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  idempotency_key TEXT UNIQUE NOT NULL,
  
  canonical_user_id TEXT NOT NULL,
  competition_id TEXT NOT NULL,
  
  status TEXT DEFAULT 'processing' NOT NULL,
  response_data JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_payment_idempotency_idempotency_key ON payment_idempotency(idempotency_key);
CREATE INDEX idx_payment_idempotency_canonical_user_id ON payment_idempotency(canonical_user_id);
CREATE INDEX idx_payment_idempotency_expires_at ON payment_idempotency(expires_at);

-- payment_webhook_events: Track payment provider webhooks
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_id TEXT UNIQUE NOT NULL,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_payment_webhook_events_event_id ON payment_webhook_events(event_id);
CREATE INDEX idx_payment_webhook_events_provider ON payment_webhook_events(provider);
CREATE INDEX idx_payment_webhook_events_processed ON payment_webhook_events(processed);

-- payments_jobs: Async payment job queue
CREATE TABLE IF NOT EXISTS payments_jobs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  job_type TEXT NOT NULL,
  canonical_user_id TEXT,
  competition_id TEXT,
  order_id TEXT,
  status TEXT DEFAULT 'pending' NOT NULL,
  payload JSONB,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_payments_jobs_status ON payments_jobs(status);
CREATE INDEX idx_payments_jobs_job_type ON payments_jobs(job_type);
CREATE INDEX idx_payments_jobs_canonical_user_id ON payments_jobs(canonical_user_id);

-- custody_transactions: Custody provider (e.g., Coinbase Custody) transactions
CREATE TABLE IF NOT EXISTS custody_transactions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  canonical_user_id TEXT,
  transaction_type TEXT NOT NULL,
  amount NUMERIC(20, 6),
  currency TEXT DEFAULT 'USD',
  provider TEXT NOT NULL,
  provider_transaction_id TEXT,
  status TEXT DEFAULT 'pending' NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_custody_transactions_user_id ON custody_transactions(user_id);
CREATE INDEX idx_custody_transactions_canonical_user_id ON custody_transactions(canonical_user_id);
CREATE INDEX idx_custody_transactions_provider ON custody_transactions(provider);
CREATE INDEX idx_custody_transactions_status ON custody_transactions(status);

-- internal_transfers: Internal balance transfers between users
CREATE TABLE IF NOT EXISTS internal_transfers (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  transfer_id TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  amount NUMERIC(20, 6) NOT NULL,
  currency TEXT DEFAULT 'USD' NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL,
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_internal_transfers_from_user_id ON internal_transfers(from_user_id);
CREATE INDEX idx_internal_transfers_to_user_id ON internal_transfers(to_user_id);
CREATE INDEX idx_internal_transfers_status ON internal_transfers(status);

-- purchase_requests: Purchase request tracking for async operations
CREATE TABLE IF NOT EXISTS purchase_requests (
  request_id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  competition_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  canonical_user_id TEXT,
  ticket_count INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_purchase_requests_user_id ON purchase_requests(user_id);
CREATE INDEX idx_purchase_requests_canonical_user_id ON purchase_requests(canonical_user_id);
CREATE INDEX idx_purchase_requests_competition_id ON purchase_requests(competition_id);
CREATE INDEX idx_purchase_requests_status ON purchase_requests(status);

-- ============================================================================
-- SECTION 7: CMS & CONTENT TABLES
-- ============================================================================

-- faqs: Frequently asked questions
CREATE TABLE IF NOT EXISTS faqs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  category TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_faqs_display_order ON faqs(display_order);
CREATE INDEX idx_faqs_category ON faqs(category);
CREATE INDEX idx_faqs_is_active ON faqs(is_active);

-- hero_competitions: Featured homepage hero competitions
CREATE TABLE IF NOT EXISTS hero_competitions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  competition_id TEXT,
  title TEXT,
  description TEXT,
  image_url TEXT,
  background_image_url TEXT,
  cta_text TEXT,
  cta_link TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_hero_competitions_display_order ON hero_competitions(display_order);
CREATE INDEX idx_hero_competitions_is_active ON hero_competitions(is_active);

-- partners: Partner/sponsor information
CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  logo_url TEXT,
  website_url TEXT,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_partners_display_order ON partners(display_order);
CREATE INDEX idx_partners_is_active ON partners(is_active);

-- testimonials: User testimonials
CREATE TABLE IF NOT EXISTS testimonials (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  rating INTEGER,
  avatar_url TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_testimonials_display_order ON testimonials(display_order);
CREATE INDEX idx_testimonials_is_active ON testimonials(is_active);

-- site_stats: Platform statistics
CREATE TABLE IF NOT EXISTS site_stats (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  icon TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_site_stats_display_order ON site_stats(display_order);

-- site_metadata: General site metadata
CREATE TABLE IF NOT EXISTS site_metadata (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(category, key)
);

CREATE INDEX idx_site_metadata_category ON site_metadata(category);

-- ============================================================================
-- SECTION 8: NOTIFICATION TABLES
-- ============================================================================

-- notifications: System notifications
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info' NOT NULL,
  is_global BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ
);

CREATE INDEX idx_notifications_is_active ON notifications(is_active);
CREATE INDEX idx_notifications_is_global ON notifications(is_global);

-- user_notifications: Per-user notifications
CREATE TABLE IF NOT EXISTS user_notifications (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  canonical_user_id TEXT NOT NULL,
  user_id TEXT,
  
  notification_id TEXT,
  
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info' NOT NULL,
  
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_user_notifications_canonical_user_id ON user_notifications(canonical_user_id);
CREATE INDEX idx_user_notifications_user_id ON user_notifications(user_id);
CREATE INDEX idx_user_notifications_is_read ON user_notifications(is_read);
CREATE INDEX idx_user_notifications_notification_id ON user_notifications(notification_id);

-- ============================================================================
-- SECTION 9: ADMIN TABLES
-- ============================================================================

-- admin_users: Admin user accounts
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE INDEX idx_admin_users_username ON admin_users(username);

-- admin_sessions: Admin session tracking
CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  session_id TEXT UNIQUE NOT NULL,
  admin_user_id TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_admin_sessions_session_id ON admin_sessions(session_id);
CREATE INDEX idx_admin_sessions_admin_user_id ON admin_sessions(admin_user_id);

-- ============================================================================
-- SECTION 10: HELPER TABLES
-- ============================================================================

-- confirmation_incident_log: Track payment confirmation issues
CREATE TABLE IF NOT EXISTS confirmation_incident_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  incident_type TEXT NOT NULL,
  payment_intent_id TEXT,
  canonical_user_id TEXT,
  competition_id TEXT,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_confirmation_incident_log_payment_intent_id ON confirmation_incident_log(payment_intent_id);
CREATE INDEX idx_confirmation_incident_log_canonical_user_id ON confirmation_incident_log(canonical_user_id);

-- _entries_progress: Track entry processing progress (internal)
CREATE TABLE IF NOT EXISTS _entries_progress (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  competition_id TEXT NOT NULL,
  processed_count INTEGER DEFAULT 0,
  total_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'processing',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMIT;
