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
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  canonical_user_id text UNIQUE CHECK (canonical_user_id IS NULL OR canonical_user_id ~ '^prize:pid:0x[a-fA-F0-9]{40}$'::text OR canonical_user_id ~ '^prize:pid:temp[0-9]+$'::text),
  uid text NOT NULL DEFAULT (gen_random_uuid())::text UNIQUE,
  privy_user_id text,
  email text UNIQUE,
  wallet_address text UNIQUE,
  base_wallet_address text UNIQUE,
  eth_wallet_address text UNIQUE,
  username text,
  avatar_url text,
  usdc_balance numeric NOT NULL DEFAULT 0,
  bonus_balance numeric NOT NULL DEFAULT 0,
  has_used_new_user_bonus boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  smart_wallet_address text,
  country text,
  first_name text,
  last_name text,
  telegram_handle text,
  is_admin boolean NOT NULL DEFAULT false,
  auth_provider text,
  wallet_linked text,
  linked_wallets jsonb DEFAULT '[]'::jsonb,
  primary_wallet_address text,
  CONSTRAINT canonical_users_pkey PRIMARY KEY (id)
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
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  canonical_user_id text,
  transaction_type text,
  amount numeric,
  currency text DEFAULT 'USD'::text,
  balance_before numeric,
  balance_after numeric,
  reference_id text UNIQUE,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  top_up_tx_id text,
  type text,
  payment_provider text,
  CONSTRAINT balance_ledger_pkey PRIMARY KEY (id),
  CONSTRAINT fk_balance_ledger_canonical_user FOREIGN KEY (canonical_user_id) REFERENCES canonical_users(canonical_user_id)
);

CREATE INDEX idx_balance_ledger_canonical_user_id ON balance_ledger(canonical_user_id);
CREATE INDEX idx_balance_ledger_reference_id ON balance_ledger(reference_id);
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
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text,
  canonical_user_id text,
  wallet_address text,
  type text,
  amount numeric,
  currency text DEFAULT 'USDC'::text,
  balance_before numeric,
  balance_after numeric,
  competition_id uuid,
  order_id uuid,
  description text,
  status text DEFAULT 'completed'::text,
  created_at timestamp with time zone DEFAULT now(),
  user_privy_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  provider text DEFAULT (metadata ->> 'provider'::text),
  tx_ref text DEFAULT (metadata ->> 'tx_ref'::text),
  payment_provider text,
  payment_status text,
  ticket_count integer,
  webhook_ref text UNIQUE,
  charge_id text UNIQUE,
  charge_code text,
  checkout_url text,
  updated_at timestamp with time zone DEFAULT now(),
  primary_provider text,
  fallback_provider text,
  provider_attempts integer DEFAULT 0,
  provider_error text,
  posted_to_balance boolean DEFAULT false,
  completed_at timestamp with time zone,
  expires_at timestamp with time zone,
  method text,
  tx_id text,
  network text,
  notes text,
  canonical_user_id_norm text DEFAULT
    CASE
      WHEN (canonical_user_id IS NULL) THEN NULL::text
      ELSE ('prize:pid:'::text || lower(replace(canonical_user_id, 'prize:pid:'::text, ''::text)))
    END,
  ticket_numbers text,
  CONSTRAINT user_transactions_pkey PRIMARY KEY (id)
);

-- Note: FK to competitions(id) added via ALTER TABLE after competitions table is created

CREATE INDEX idx_user_transactions_canonical_user_id ON user_transactions(canonical_user_id);
CREATE INDEX idx_user_transactions_user_id ON user_transactions(user_id);
CREATE INDEX idx_user_transactions_wallet_address ON user_transactions(LOWER(wallet_address));
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
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text,
  description text,
  image_url text,
  ticket_price numeric DEFAULT 1,
  total_tickets integer DEFAULT 100,
  sold_tickets integer DEFAULT 0,
  status text DEFAULT 'upcoming'::text,
  start_time timestamp with time zone DEFAULT now(),
  end_time timestamp with time zone,
  winner_count integer DEFAULT 1,
  prize_description text,
  vrfulfillment_address text,
  vrf_subscription_id integer,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  deleted boolean DEFAULT false,
  max_tickets_per_user_percentage integer,
  crdate timestamp with time zone DEFAULT now(),
  description_text text,
  end_date timestamp with time zone,
  is_featured boolean DEFAULT false,
  is_instant_win boolean DEFAULT false,
  num_winners integer,
  prize_type text,
  prize_value numeric,
  tickets_sold integer,
  uid uuid DEFAULT gen_random_uuid(),
  winning_ticket_count integer,
  vrf_request_id text,
  vrf_status text DEFAULT 'pending'::text,
  vrf_tx_hash text,
  onchain_competition_id text,
  vrf_random_words text[],
  vrf_proof text,
  winner_address text,
  start_date timestamp with time zone DEFAULT now(),
  vrf_draw_requested_at timestamp with time zone,
  vrf_draw_completed_at timestamp with time zone,
  vrf_randomness jsonb,
  vrf_error text,
  vrf_completed_at timestamp with time zone,
  draw_date timestamp with time zone,
  vrf_error_at timestamp with time zone,
  onchain_pid text,
  vrf_verified boolean DEFAULT false,
  outcomes_vrf_seed text,
  outcomes_generated_at timestamp with time zone,
  randomness_verified_at timestamp with time zone,
  winning_ticket_numbers text,
  winning_tickets_generated text,
  CONSTRAINT competitions_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_competitions_status ON competitions(status);
CREATE INDEX idx_competitions_uid ON competitions(uid);
CREATE INDEX idx_competitions_is_instant_win ON competitions(is_instant_win);
CREATE INDEX idx_competitions_is_featured ON competitions(is_featured);
CREATE INDEX idx_competitions_end_date ON competitions(end_date);
CREATE INDEX idx_competitions_sold_tickets ON competitions(sold_tickets);

-- competition_entries: Finalized entries for competitions
CREATE TABLE IF NOT EXISTS competition_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  canonical_user_id text NOT NULL,
  competition_id uuid NOT NULL,
  wallet_address text,
  tickets_count integer NOT NULL DEFAULT 0,
  ticket_numbers_csv text,
  amount_spent numeric,
  payment_methods text,
  latest_purchase_at timestamp with time zone,
  is_winner boolean,
  prize_tiers text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  username text,
  competition_title text,
  competition_description text,
  amount_paid numeric,
  CONSTRAINT competition_entries_pkey PRIMARY KEY (id),
  CONSTRAINT fk_competition_entries_competition FOREIGN KEY (competition_id) REFERENCES competitions(id)
);

CREATE INDEX idx_competition_entries_competition_id ON competition_entries(competition_id);
CREATE INDEX idx_competition_entries_canonical_user_id ON competition_entries(canonical_user_id);
CREATE INDEX idx_competition_entries_is_winner ON competition_entries(is_winner);

-- competition_entries_purchases: Individual purchase records within entries
CREATE TABLE IF NOT EXISTS competition_entries_purchases (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  canonical_user_id text NOT NULL,
  competition_id uuid NOT NULL,
  purchase_key text NOT NULL,
  tickets_count integer NOT NULL DEFAULT 0,
  amount_spent numeric NOT NULL DEFAULT 0,
  ticket_numbers_csv text,
  purchased_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT competition_entries_purchases_pkey PRIMARY KEY (id)
);

-- tickets: Individual ticket records
CREATE TABLE IF NOT EXISTS tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  competition_id uuid,
  ticket_number integer,
  status text DEFAULT 'available'::text CHECK (status = ANY (ARRAY['available'::text, 'reserved'::text, 'confirmed'::text, 'sold'::text, 'refunded'::text])),
  purchased_by text,
  purchased_at timestamp with time zone,
  order_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  user_id text,
  purchase_price numeric,
  is_active boolean DEFAULT true,
  is_winner boolean DEFAULT false,
  privy_user_id text,
  prize_tier text,
  pending_ticket_id uuid,
  payment_amount numeric,
  payment_tx_hash text,
  purchase_date timestamp with time zone,
  canonical_user_id text,
  wallet_address text,
  payment_provider text,
  tx_id text,
  transaction_hash text DEFAULT COALESCE(payment_tx_hash, tx_id),
  user_privy_id text,
  purchase_key text,
  CONSTRAINT tickets_pkey PRIMARY KEY (id),
  CONSTRAINT tickets_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES competitions(id)
);

CREATE INDEX idx_tickets_competition_id ON tickets(competition_id);
CREATE INDEX idx_tickets_canonical_user_id ON tickets(canonical_user_id);
CREATE INDEX idx_tickets_user_id ON tickets(user_id);
CREATE INDEX idx_tickets_wallet_address ON tickets(LOWER(wallet_address));
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_ticket_number ON tickets(ticket_number);
CREATE INDEX idx_tickets_is_winner ON tickets(is_winner);
CREATE INDEX idx_tickets_competition_user ON tickets(competition_id, canonical_user_id);

-- tickets_sold: Fast lookup for sold tickets
CREATE TABLE IF NOT EXISTS tickets_sold (
  competition_id uuid NOT NULL,
  ticket_number integer NOT NULL,
  purchaser_id text NOT NULL,
  sold_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tickets_sold_pkey PRIMARY KEY (competition_id, ticket_number)
);

CREATE INDEX idx_tickets_sold_competition_id ON tickets_sold(competition_id);
CREATE INDEX idx_tickets_sold_purchaser_id ON tickets_sold(purchaser_id);

-- pending_tickets: Temporary ticket reservations during checkout
CREATE TABLE IF NOT EXISTS pending_tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text,
  canonical_user_id text,
  wallet_address text,
  competition_id uuid,
  status text DEFAULT 'pending'::text,
  hold_minutes integer DEFAULT 15,
  expires_at timestamp with time zone,
  reservation_id uuid DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  ticket_count integer,
  ticket_price numeric DEFAULT 1,
  total_amount numeric DEFAULT 0,
  session_id text,
  confirmed_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now(),
  transaction_hash text,
  payment_provider text,
  ticket_numbers text[],
  payment_id text,
  idempotency_key text,
  privy_user_id text,
  user_privy_id text,
  note text,
  CONSTRAINT pending_tickets_pkey PRIMARY KEY (id),
  CONSTRAINT pending_tickets_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES competitions(id),
  CONSTRAINT fk_pending_tickets_canonical_user FOREIGN KEY (canonical_user_id) REFERENCES canonical_users(canonical_user_id)
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
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  userid text,
  wallet_address text,
  competitionid uuid,
  ticketnumbers text,
  purchasedate timestamp with time zone DEFAULT now(),
  status text DEFAULT 'active'::text,
  created_at timestamp with time zone DEFAULT now(),
  uid text,
  chain text,
  transactionhash text,
  numberoftickets integer,
  amountspent numeric,
  canonical_user_id text,
  privy_user_id text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT joincompetition_pkey PRIMARY KEY (id),
  CONSTRAINT joincompetition_canonical_user_id_fkey FOREIGN KEY (canonical_user_id) REFERENCES canonical_users(canonical_user_id),
  CONSTRAINT joincompetition_competitionid_fkey FOREIGN KEY (competitionid) REFERENCES competitions(id)
);

CREATE INDEX idx_joincompetition_userid ON joincompetition(userid);
CREATE INDEX idx_joincompetition_competitionid ON joincompetition(competitionid);
CREATE INDEX idx_joincompetition_wallet_address ON joincompetition(LOWER(wallet_address));
CREATE INDEX idx_joincompetition_canonical_user_id ON joincompetition(canonical_user_id);

-- joincompetition_ticket_claims: Track individual ticket claims within a join
CREATE TABLE IF NOT EXISTS joincompetition_ticket_claims (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  join_id uuid NOT NULL,
  competitionid uuid NOT NULL,
  ticket_number text NOT NULL,
  status text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT joincompetition_ticket_claims_pkey PRIMARY KEY (id),
  CONSTRAINT joincompetition_ticket_claims_join_id_fkey FOREIGN KEY (join_id) REFERENCES joincompetition(id)
);

-- joined_competitions: Normalized join records
CREATE TABLE IF NOT EXISTS joined_competitions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_uid uuid,
  competition_id uuid,
  number_of_tickets integer NOT NULL,
  wallet_address text,
  join_date timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  canonical_user_id text CHECK (canonical_user_id IS NULL OR canonical_user_id ~ '^prize:pid:0x[a-f0-9]{40}$'::text),
  privy_user_id text,
  CONSTRAINT joined_competitions_pkey PRIMARY KEY (id),
  CONSTRAINT joined_competitions_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES competitions(id)
);

-- ============================================================================
-- SECTION 5: WINNER TABLES
-- ============================================================================

-- winners: Main winners table
CREATE TABLE IF NOT EXISTS winners (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  competition_id uuid,
  user_id text,
  wallet_address text,
  prize_position integer DEFAULT 1,
  prize_amount numeric,
  vrfulfillment_address text,
  vrf_proof text,
  claimed boolean DEFAULT false,
  claimed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  uid text,
  username text,
  ticket_number integer,
  prize text,
  prize_value numeric,
  country text,
  prize_claimed boolean DEFAULT false,
  tx_hash text,
  is_instant_win boolean DEFAULT false,
  is_promoted boolean DEFAULT false,
  "isShow" boolean DEFAULT true,
  vrf_request_id text,
  won_at timestamp with time zone DEFAULT now(),
  crdate text,
  CONSTRAINT winners_pkey PRIMARY KEY (id),
  CONSTRAINT winners_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES competitions(id)
);

CREATE INDEX idx_winners_competition_id ON winners(competition_id);
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
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'USDC'::text,
  status text NOT NULL DEFAULT 'pending'::text,
  payment_status text,
  payment_provider text,
  payment_intent_id text,
  ticket_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  order_type text,
  amount_usd numeric,
  payment_method text,
  payment_session_id text,
  payment_url text,
  payment_tx_hash text,
  completed_at timestamp with time zone,
  canonical_user_id text NOT NULL,
  ledger_ref text,
  transaction_ref text,
  source text,
  source_id uuid,
  bonus_amount numeric,
  cash_amount numeric,
  bonus_currency text,
  user_wallet_address text,
  user_privy_id text,
  notes text,
  error_message text,
  posted_to_balance boolean DEFAULT false,
  is_backfill boolean DEFAULT false,
  purchase_at timestamp with time zone,
  unique_order_key text UNIQUE,
  competition_title text,
  competition_description text,
  competition_id uuid,
  CONSTRAINT orders_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_orders_canonical_user_id ON orders(canonical_user_id);
CREATE INDEX idx_orders_competition_id ON orders(competition_id);
CREATE INDEX idx_orders_status ON orders(status);

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

-- ============================================================================
-- SECTION 11: CDP TABLES
-- ============================================================================

-- cdp_event_queue: Queue for CDP events
CREATE TABLE IF NOT EXISTS cdp_event_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_name text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT cdp_event_queue_pkey PRIMARY KEY (id)
);

-- cdp_transactions: CDP transaction records
CREATE TABLE IF NOT EXISTS cdp_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  external_id text NOT NULL UNIQUE,
  event_type text,
  amount numeric,
  currency text,
  status text,
  canonical_user_id text,
  wallet_address text,
  user_id text,
  competition_id uuid,
  tx_ref text,
  tx_id text,
  occurred_at timestamp with time zone,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_concat text,
  ticket_count integer,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT cdp_transactions_pkey PRIMARY KEY (id)
);

-- ============================================================================
-- SECTION 12: DEFERRED FOREIGN KEY CONSTRAINTS
-- ============================================================================
-- These FKs reference tables defined in later sections, so they must be added after all tables exist.

ALTER TABLE user_transactions
  ADD CONSTRAINT user_transactions_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES competitions(id);

COMMIT;
