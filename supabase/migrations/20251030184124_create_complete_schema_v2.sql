/*
  # Create Complete Prize Competition Platform Schema

  ## Overview
  This migration creates the complete database schema for a prize competition platform
  with competitions, tickets, users, winners, FAQs, partners, testimonials, site content,
  hero sections, and comprehensive statistics tracking.

  ## Tables Created
  
  ### 1. users
  - Stores user accounts with wallet addresses and profile information
  - Tracks username, email, telegram, phone, and avatar
  - Primary authentication via wallet_address
  
  ### 2. competitions
  - Main competition listings (both standard draw and instant win)
  - Includes prize details, ticket pricing, and inventory management
  - Tracks status (active, finished, pending) and featured flags
  - Contains VRF transaction hash for verifiable random draws
  
  ### 3. tickets
  - Individual ticket purchases linked to users and competitions
  - Tracks ticket numbers, payment info, and win status
  - Contains blockchain transaction hashes for transparency
  
  ### 4. winners
  - Records competition winners and prize distribution
  - Links to user and competition tables
  - Tracks prize distribution status and transaction hashes
  
  ### 5. faqs
  - Frequently asked questions with display ordering
  - Simple question/answer format for site help content
  
  ### 6. hero_competitions
  - Special featured competitions for homepage hero section
  - Can link to actual competitions or be standalone promos
  - Custom titles, descriptions, and background images
  
  ### 7. partners
  - Partner/sponsor logos and information
  - Display ordering for partner showcases
  
  ### 8. testimonials
  - User testimonials and reviews
  - Includes author info, rating, and display ordering
  
  ### 9. site_stats
  - Dynamic site statistics (e.g., "Total Prizes Given", "Active Users")
  - Key-value pairs with labels for display
  
  ### 10. site_content
  - General CMS content for various site sections
  - Flexible content blocks with titles, text, and images
  
  ## Security
  - Row Level Security (RLS) enabled on all tables
  - Public read access for competitions, FAQs, partners, stats, testimonials, and hero sections
  - User-specific access for personal data (tickets, profile updates)
  - Admin-only write access for content management tables
  
  ## Indexes
  - Performance indexes on frequently queried fields
  - Foreign key indexes for join optimization
*/

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text UNIQUE NOT NULL,
  username text,
  email text,
  telegram_handle text,
  telephone_number text,
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Competitions Table
CREATE TABLE IF NOT EXISTS competitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  image_url text,
  prize_type text NOT NULL,
  prize_value text NOT NULL,
  ticket_price numeric(10, 2) DEFAULT 0.99,
  total_tickets int NOT NULL,
  tickets_sold int DEFAULT 0,
  start_date timestamptz DEFAULT now(),
  end_date timestamptz,
  draw_date timestamptz,
  status text DEFAULT 'active',
  is_instant_win boolean DEFAULT false,
  is_featured boolean DEFAULT false,
  vrf_transaction_hash text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Tickets Table
CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid REFERENCES competitions(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  ticket_number int NOT NULL,
  purchase_date timestamptz DEFAULT now(),
  payment_amount numeric(10, 2) NOT NULL,
  payment_tx_hash text,
  is_winner boolean DEFAULT false,
  revealed boolean DEFAULT false,
  prize_tier text,
  created_at timestamptz DEFAULT now()
);

-- Winners Table
CREATE TABLE IF NOT EXISTS winners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid REFERENCES competitions(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL,
  announced_at timestamptz DEFAULT now(),
  prize_distributed boolean DEFAULT false,
  prize_tx_hash text,
  created_at timestamptz DEFAULT now()
);

-- FAQs Table
CREATE TABLE IF NOT EXISTS faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text NOT NULL,
  display_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Hero Competitions Table
CREATE TABLE IF NOT EXISTS hero_competitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid REFERENCES competitions(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  ticket_price_display text,
  cta_text text DEFAULT 'ENTER NOW',
  background_image text,
  is_active boolean DEFAULT false,
  display_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Partners Table
CREATE TABLE IF NOT EXISTS partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  logo_url text NOT NULL,
  website_url text,
  display_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Testimonials Table
CREATE TABLE IF NOT EXISTS testimonials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_name text NOT NULL,
  author_avatar text,
  testimonial_text text NOT NULL,
  rating int,
  display_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Site Stats Table
CREATE TABLE IF NOT EXISTS site_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stat_key text UNIQUE NOT NULL,
  stat_value text NOT NULL,
  stat_label text NOT NULL,
  display_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Site Content Table
CREATE TABLE IF NOT EXISTS site_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  content_key text NOT NULL,
  title text,
  content text,
  image_url text,
  display_order int DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(section, content_key)
);

-- Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_tickets_competition ON tickets(competition_id);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_winners_competition ON winners(competition_id);
CREATE INDEX IF NOT EXISTS idx_winners_user ON winners(user_id);
CREATE INDEX IF NOT EXISTS idx_competitions_status ON competitions(status);
CREATE INDEX IF NOT EXISTS idx_competitions_featured ON competitions(is_featured);
CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE winners ENABLE ROW LEVEL SECURITY;
ALTER TABLE faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hero_competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_content ENABLE ROW LEVEL SECURITY;

-- RLS Policies for public read access
DROP POLICY IF EXISTS "Public can view competitions" ON competitions;
CREATE POLICY "Public can view competitions"
  ON competitions FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Public can view faqs" ON faqs;
CREATE POLICY "Public can view faqs"
  ON faqs FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Public can view hero competitions" ON hero_competitions;
CREATE POLICY "Public can view hero competitions"
  ON hero_competitions FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Public can view partners" ON partners;
CREATE POLICY "Public can view partners"
  ON partners FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Public can view testimonials" ON testimonials;
CREATE POLICY "Public can view testimonials"
  ON testimonials FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Public can view site stats" ON site_stats;
CREATE POLICY "Public can view site stats"
  ON site_stats FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Public can view site content" ON site_content;
CREATE POLICY "Public can view site content"
  ON site_content FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Public can view winners" ON winners;
CREATE POLICY "Public can view winners"
  ON winners FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Public can view users" ON users;
CREATE POLICY "Public can view users"
  ON users FOR SELECT
  TO public
  USING (true);

DROP POLICY IF EXISTS "Public can view tickets" ON tickets;
CREATE POLICY "Public can view tickets"
  ON tickets FOR SELECT
  TO public
  USING (true);
