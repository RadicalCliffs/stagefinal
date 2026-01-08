/*
  # Add Typography Controls to Hero Competitions Table

  ## Overview
  This migration adds typography override fields to the hero_competitions table
  to allow customization of font sizes and weights for titles and descriptions.

  ## Changes
  - Add title_font_size column (text) for custom title font size (e.g., "3rem", "48px")
  - Add title_font_weight column (text) for custom title font weight (e.g., "700", "bold")
  - Add description_font_size column (text) for custom description font size
  - Add description_font_weight column (text) for custom description font weight
*/

-- Add typography control columns to hero_competitions table
ALTER TABLE hero_competitions
ADD COLUMN IF NOT EXISTS title_font_size text,
ADD COLUMN IF NOT EXISTS title_font_weight text,
ADD COLUMN IF NOT EXISTS description_font_size text,
ADD COLUMN IF NOT EXISTS description_font_weight text;

-- Add index for active hero competitions (for faster homepage queries)
CREATE INDEX IF NOT EXISTS idx_hero_competitions_active
  ON hero_competitions(is_active, display_order)
  WHERE is_active = true;
