-- Implement Cascade Archive System (simplified)
-- This migration adds soft-delete columns to tables that exist

-- Add archived_at columns only to tables we know exist
ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS archived_by TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT DEFAULT NULL;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS archived_by TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS archive_reason TEXT DEFAULT NULL;

-- Add indexes for performance on archive queries
CREATE INDEX IF NOT EXISTS idx_competitions_archived_at ON competitions(archived_at);
CREATE INDEX IF NOT EXISTS idx_tickets_archived_at ON tickets(archived_at);

-- Archive competition function
CREATE OR REPLACE FUNCTION archive_competition(
  p_competition_id UUID,
  p_archived_by TEXT DEFAULT 'system',
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $archive_comp$
DECLARE
  v_archived_tickets INTEGER := 0;
BEGIN
  -- Mark competition as archived
  UPDATE competitions
  SET
    archived_at = NOW(),
    archived_by = p_archived_by,
    archive_reason = p_reason,
    updated_at = NOW()
  WHERE id = p_competition_id
    AND archived_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Competition not found or already archived'
    );
  END IF;

  -- Archive all tickets for this competition
  UPDATE tickets
  SET
    archived_at = NOW(),
    archived_by = p_archived_by,
    archive_reason = 'Parent competition archived: ' || COALESCE(p_reason, 'No reason provided')
  WHERE competition_id = p_competition_id
    AND archived_at IS NULL;

  GET DIAGNOSTICS v_archived_tickets = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'competition_id', p_competition_id,
    'archived_at', NOW(),
    'archived_by', p_archived_by,
    'reason', p_reason,
    'cascaded_archives', jsonb_build_object(
      'tickets', v_archived_tickets
    )
  );
END;
$archive_comp$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION archive_competition(UUID, TEXT, TEXT) TO service_role;

-- Restore competition function
CREATE OR REPLACE FUNCTION restore_competition(
  p_competition_id UUID,
  p_restored_by TEXT DEFAULT 'system'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $restore_comp$
DECLARE
  v_restored_tickets INTEGER := 0;
BEGIN
  -- Check if competition exists and is archived
  IF NOT EXISTS (
    SELECT 1 FROM competitions
    WHERE id = p_competition_id AND archived_at IS NOT NULL
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Competition not found or not archived'
    );
  END IF;

  -- Restore the competition
  UPDATE competitions
  SET
    archived_at = NULL,
    archived_by = NULL,
    archive_reason = NULL,
    updated_at = NOW()
  WHERE id = p_competition_id
    AND archived_at IS NOT NULL;

  -- Restore all tickets for this competition
  UPDATE tickets
  SET
    archived_at = NULL,
    archived_by = NULL,
    archive_reason = NULL
  WHERE competition_id = p_competition_id
    AND archived_at IS NOT NULL;

  GET DIAGNOSTICS v_restored_tickets = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'competition_id', p_competition_id,
    'restored_at', NOW(),
    'restored_by', p_restored_by,
    'cascaded_restores', jsonb_build_object(
      'tickets', v_restored_tickets
    )
  );
END;
$restore_comp$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION restore_competition(UUID, TEXT) TO service_role;
