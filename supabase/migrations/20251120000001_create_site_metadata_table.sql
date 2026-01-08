/*
  # Create Site Metadata Table

  ## Overview
  This migration creates the site_metadata table for storing site-wide configuration
  and settings such as hero carousel intervals, feature flags, and other metadata.

  ## Tables Created

  ### site_metadata
  - `id` (uuid, primary key) - Unique identifier
  - `category` (text) - Category grouping (e.g., 'hero_carousel', 'features')
  - `key` (text) - Setting key
  - `value` (text) - Setting value
  - `description` (text) - Human-readable description
  - `is_active` (boolean) - Whether setting is active
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ## Security
  - Enable RLS on site_metadata table
  - Allow public read access
  - Restrict write access to service role

  ## Indexes
  - Index on (category, key) for fast lookups
*/

-- Create site_metadata table
CREATE TABLE IF NOT EXISTS site_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  key text NOT NULL,
  value text,
  description text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(category, key)
);

-- Enable RLS
ALTER TABLE site_metadata ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Public can view site_metadata"
  ON site_metadata
  FOR SELECT
  TO public
  USING (is_active = true);

-- Allow service role full access
CREATE POLICY "Service role can manage site_metadata"
  ON site_metadata
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_site_metadata_category_key
  ON site_metadata(category, key);

-- Insert default hero carousel settings
INSERT INTO site_metadata (category, key, value, description)
VALUES
  ('hero_carousel', 'slider_interval', '5000', 'Hero carousel autoplay interval in milliseconds'),
  ('hero_carousel', 'autoplay_enabled', 'true', 'Enable/disable hero carousel autoplay'),
  ('hero_carousel', 'pagination_enabled', 'true', 'Enable/disable hero carousel pagination dots')
ON CONFLICT (category, key) DO NOTHING;
