/*
  # Add Comprehensive Admin Control Fields

  1. Changes to competitions table
    - Add `is_hidden` boolean to hide/show competitions from public view
    - Add `is_promoted` boolean to feature/promote specific competitions on homepage
    - Add `font_size_override` text field for custom text sizing
    - Add `font_weight_override` text field for custom boldness

  2. New tables
    - `site_stats` - Editable site statistics (prizes given, users, etc.)
    - `faqs` - Manage FAQ content
    - `partners` - Partner/sponsor logos and info
    - `site_content` - General editable content (text, headings, descriptions)
    - `testimonials` - Customer reviews/testimonials
    - `hero_competitions` - Hero section competitions for homepage

  3. Security
    - Enable RLS on all new tables
    - Public can read active content
    - Only service role can manage content
*/

-- Add control fields to competitions table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'competitions' AND column_name = 'is_hidden') THEN
    ALTER TABLE competitions ADD COLUMN is_hidden BOOLEAN DEFAULT false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'competitions' AND column_name = 'is_promoted') THEN
    ALTER TABLE competitions ADD COLUMN is_promoted BOOLEAN DEFAULT false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'competitions' AND column_name = 'font_size_override') THEN
    ALTER TABLE competitions ADD COLUMN font_size_override TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'competitions' AND column_name = 'font_weight_override') THEN
    ALTER TABLE competitions ADD COLUMN font_weight_override TEXT;
  END IF;
END $$;

-- Create site_stats table if not exists, then add missing columns
CREATE TABLE IF NOT EXISTS site_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stat_key TEXT NOT NULL UNIQUE,
  stat_value TEXT NOT NULL,
  stat_label TEXT NOT NULL,
  value_font_size TEXT,
  value_font_weight TEXT,
  label_font_size TEXT,
  label_font_weight TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add missing columns to site_stats table if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'site_stats' AND column_name = 'value_font_size') THEN
    ALTER TABLE site_stats ADD COLUMN value_font_size TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'site_stats' AND column_name = 'value_font_weight') THEN
    ALTER TABLE site_stats ADD COLUMN value_font_weight TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'site_stats' AND column_name = 'label_font_size') THEN
    ALTER TABLE site_stats ADD COLUMN label_font_size TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'site_stats' AND column_name = 'label_font_weight') THEN
    ALTER TABLE site_stats ADD COLUMN label_font_weight TEXT;
  END IF;
END $$;

-- Create faqs table if not exists, then add missing columns
CREATE TABLE IF NOT EXISTS faqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add missing columns to faqs table if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'faqs' AND column_name = 'category') THEN
    ALTER TABLE faqs ADD COLUMN category TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'faqs' AND column_name = 'is_active') THEN
    ALTER TABLE faqs ADD COLUMN is_active BOOLEAN DEFAULT true;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'faqs' AND column_name = 'updated_at') THEN
    ALTER TABLE faqs ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;

-- Create partners table if not exists, then add missing columns
CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_name TEXT NOT NULL,
  logo_url TEXT,
  website_url TEXT,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add missing columns to partners table if they don't exist
DO $$
BEGIN
  -- Rename 'name' column to 'partner_name' if it exists
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'partners' AND column_name = 'name') THEN
    ALTER TABLE partners RENAME COLUMN name TO partner_name;
  END IF;

  -- Make logo_url nullable if it exists and is NOT NULL
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'partners' AND column_name = 'logo_url' AND is_nullable = 'NO') THEN
    ALTER TABLE partners ALTER COLUMN logo_url DROP NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'partners' AND column_name = 'description') THEN
    ALTER TABLE partners ADD COLUMN description TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'partners' AND column_name = 'updated_at') THEN
    ALTER TABLE partners ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;

-- Create hero_competitions table for homepage hero sections if not exists, then add missing columns
CREATE TABLE IF NOT EXISTS hero_competitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id VARCHAR,
  title TEXT NOT NULL,
  description TEXT,
  ticket_price_display TEXT,
  cta_text TEXT DEFAULT 'ENTER NOW',
  background_image TEXT,
  title_font_size TEXT,
  title_font_weight TEXT,
  description_font_size TEXT,
  description_font_weight TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add missing columns to hero_competitions table if they don't exist
DO $$
BEGIN
  -- Change competition_id type from UUID to VARCHAR if needed
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'hero_competitions' 
    AND column_name = 'competition_id' 
    AND data_type = 'uuid'
  ) THEN
    -- Drop the foreign key constraint first
    ALTER TABLE hero_competitions DROP CONSTRAINT IF EXISTS hero_competitions_competition_id_fkey;
    -- Change the column type
    ALTER TABLE hero_competitions ALTER COLUMN competition_id TYPE VARCHAR USING competition_id::text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hero_competitions' AND column_name = 'title_font_size') THEN
    ALTER TABLE hero_competitions ADD COLUMN title_font_size TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hero_competitions' AND column_name = 'title_font_weight') THEN
    ALTER TABLE hero_competitions ADD COLUMN title_font_weight TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hero_competitions' AND column_name = 'description_font_size') THEN
    ALTER TABLE hero_competitions ADD COLUMN description_font_size TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hero_competitions' AND column_name = 'description_font_weight') THEN
    ALTER TABLE hero_competitions ADD COLUMN description_font_weight TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hero_competitions' AND column_name = 'updated_at') THEN
    ALTER TABLE hero_competitions ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;

-- Create site_content table for general editable content
CREATE TABLE IF NOT EXISTS site_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT NOT NULL,
  content_key TEXT NOT NULL,
  content_value TEXT NOT NULL,
  content_type TEXT DEFAULT 'text',
  font_size TEXT,
  font_weight TEXT,
  text_color TEXT,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(section, content_key)
);

-- Create testimonials table if not exists, then add missing columns
CREATE TABLE IF NOT EXISTS testimonials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_name TEXT NOT NULL,
  author_avatar TEXT,
  author_title TEXT,
  testimonial_text TEXT NOT NULL,
  rating INTEGER DEFAULT 5 CHECK (rating >= 1 AND rating <= 5),
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add missing columns to existing tables if they don't exist
DO $$
BEGIN
  -- FAQs table updates
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'faqs' AND column_name = 'is_active') THEN
    ALTER TABLE faqs ADD COLUMN is_active BOOLEAN DEFAULT true;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'faqs' AND column_name = 'category') THEN
    ALTER TABLE faqs ADD COLUMN category TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'faqs' AND column_name = 'updated_at') THEN
    ALTER TABLE faqs ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  END IF;

  -- Partners table updates
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'partners' AND column_name = 'name') AND
     NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'partners' AND column_name = 'partner_name') THEN
    ALTER TABLE partners RENAME COLUMN name TO partner_name;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'partners' AND column_name = 'description') THEN
    ALTER TABLE partners ADD COLUMN description TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'partners' AND column_name = 'updated_at') THEN
    ALTER TABLE partners ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  END IF;

  -- Remove NOT NULL constraint from logo_url if it exists
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'partners' AND column_name = 'logo_url' AND is_nullable = 'NO') THEN
    ALTER TABLE partners ALTER COLUMN logo_url DROP NOT NULL;
  END IF;

  -- Site stats table updates
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'site_stats' AND column_name = 'value_font_size') THEN
    ALTER TABLE site_stats ADD COLUMN value_font_size TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'site_stats' AND column_name = 'value_font_weight') THEN
    ALTER TABLE site_stats ADD COLUMN value_font_weight TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'site_stats' AND column_name = 'label_font_size') THEN
    ALTER TABLE site_stats ADD COLUMN label_font_size TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'site_stats' AND column_name = 'label_font_weight') THEN
    ALTER TABLE site_stats ADD COLUMN label_font_weight TEXT;
  END IF;

  -- Testimonials table updates
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'testimonials' AND column_name = 'author_title') THEN
    ALTER TABLE testimonials ADD COLUMN author_title TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'testimonials' AND column_name = 'updated_at') THEN
    ALTER TABLE testimonials ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  END IF;

  -- Site content table updates
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'site_content' AND column_name = 'title') AND
     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'site_content' AND column_name = 'content') AND
     NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'site_content' AND column_name = 'content_value') THEN
    -- Merge title and content into content_value
    ALTER TABLE site_content ADD COLUMN content_value TEXT;
    UPDATE site_content SET content_value = COALESCE(content, title);
    ALTER TABLE site_content ALTER COLUMN content_value SET NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'site_content' AND column_name = 'content_type') THEN
    ALTER TABLE site_content ADD COLUMN content_type TEXT DEFAULT 'text';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'site_content' AND column_name = 'font_size') THEN
    ALTER TABLE site_content ADD COLUMN font_size TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'site_content' AND column_name = 'font_weight') THEN
    ALTER TABLE site_content ADD COLUMN font_weight TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'site_content' AND column_name = 'text_color') THEN
    ALTER TABLE site_content ADD COLUMN text_color TEXT;
  END IF;

  -- Hero competitions table updates
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hero_competitions' AND column_name = 'title_font_size') THEN
    ALTER TABLE hero_competitions ADD COLUMN title_font_size TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hero_competitions' AND column_name = 'title_font_weight') THEN
    ALTER TABLE hero_competitions ADD COLUMN title_font_weight TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hero_competitions' AND column_name = 'description_font_size') THEN
    ALTER TABLE hero_competitions ADD COLUMN description_font_size TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'hero_competitions' AND column_name = 'description_font_weight') THEN
    ALTER TABLE hero_competitions ADD COLUMN description_font_weight TEXT;
  END IF;
END $$;

-- Enable RLS on new tables
ALTER TABLE site_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE hero_competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DO $$ BEGIN
  DROP POLICY IF EXISTS "Anyone can view active site stats" ON site_stats;
  DROP POLICY IF EXISTS "Service role can manage site stats" ON site_stats;
  DROP POLICY IF EXISTS "Anyone can view active FAQs" ON faqs;
  DROP POLICY IF EXISTS "Service role can manage FAQs" ON faqs;
  DROP POLICY IF EXISTS "Anyone can view active partners" ON partners;
  DROP POLICY IF EXISTS "Service role can manage partners" ON partners;
  DROP POLICY IF EXISTS "Anyone can view active hero competitions" ON hero_competitions;
  DROP POLICY IF EXISTS "Service role can manage hero competitions" ON hero_competitions;
  DROP POLICY IF EXISTS "Anyone can view active site content" ON site_content;
  DROP POLICY IF EXISTS "Service role can manage site content" ON site_content;
  DROP POLICY IF EXISTS "Anyone can view active testimonials" ON testimonials;
  DROP POLICY IF EXISTS "Service role can manage testimonials" ON testimonials;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- RLS Policies - Public read for active content
DROP POLICY IF EXISTS "Anyone can view active site stats" ON site_stats;
CREATE POLICY "Anyone can view active site stats"
  ON site_stats FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS "Anyone can view active FAQs" ON faqs;
CREATE POLICY "Anyone can view active FAQs"
  ON faqs FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS "Anyone can view active partners" ON partners;
CREATE POLICY "Anyone can view active partners"
  ON partners FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS "Anyone can view active hero competitions" ON hero_competitions;
CREATE POLICY "Anyone can view active hero competitions"
  ON hero_competitions FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS "Anyone can view active site content" ON site_content;
CREATE POLICY "Anyone can view active site content"
  ON site_content FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS "Anyone can view active testimonials" ON testimonials;
CREATE POLICY "Anyone can view active testimonials"
  ON testimonials FOR SELECT
  USING (is_active = true);

-- Service role can manage everything
DROP POLICY IF EXISTS "Service role can manage site stats" ON site_stats;
CREATE POLICY "Service role can manage site stats"
  ON site_stats FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage FAQs" ON faqs;
CREATE POLICY "Service role can manage FAQs"
  ON faqs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage partners" ON partners;
CREATE POLICY "Service role can manage partners"
  ON partners FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage hero competitions" ON hero_competitions;
CREATE POLICY "Service role can manage hero competitions"
  ON hero_competitions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage site content" ON site_content;
CREATE POLICY "Service role can manage site content"
  ON site_content FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can manage testimonials" ON testimonials;
CREATE POLICY "Service role can manage testimonials"
  ON testimonials FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_site_stats_active ON site_stats(is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_faqs_active ON faqs(is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_partners_active ON partners(is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_hero_competitions_active ON hero_competitions(is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_site_content_section ON site_content(section, is_active);
CREATE INDEX IF NOT EXISTS idx_testimonials_active ON testimonials(is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_competitions_hidden ON competitions(is_hidden);
CREATE INDEX IF NOT EXISTS idx_competitions_promoted ON competitions(is_promoted);
