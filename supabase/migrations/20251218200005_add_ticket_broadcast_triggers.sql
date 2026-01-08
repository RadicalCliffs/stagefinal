-- Migration: Add realtime broadcast triggers for ticket events
-- This enables per-competition realtime updates via Supabase broadcast channels
-- Topic: competition:{competition_id}:tickets
-- Events: ticket_reserved, ticket_sold, ticket_released, ticket_expired

-- ============================================================================
-- Part 1: Competition Ticket Broadcast Function
-- ============================================================================

-- Create the broadcast function for ticket events
CREATE OR REPLACE FUNCTION public.broadcast_ticket_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  topic_name TEXT;
  event_name TEXT;
  payload JSONB;
  v_competition_id UUID;
  v_ticket_count INTEGER;
  v_current_sold INTEGER;
  v_current_pending INTEGER;
  v_total_tickets INTEGER;
BEGIN
  -- Determine competition_id based on table
  IF TG_TABLE_NAME = 'tickets' THEN
    v_competition_id := COALESCE(NEW.competition_id, OLD.competition_id);
    v_ticket_count := 1;
  ELSIF TG_TABLE_NAME = 'pending_tickets' THEN
    v_competition_id := COALESCE(NEW.competition_id, OLD.competition_id);
    v_ticket_count := COALESCE(array_length(COALESCE(NEW.ticket_numbers, OLD.ticket_numbers), 1), 0);
  END IF;

  -- Skip if no competition_id
  IF v_competition_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Build the topic name for per-competition channel
  topic_name := 'competition:' || v_competition_id::TEXT || ':tickets';

  -- Determine event name based on table and operation
  IF TG_TABLE_NAME = 'tickets' THEN
    -- Tickets table: INSERT = sold
    IF TG_OP = 'INSERT' THEN
      event_name := 'ticket_sold';
    ELSIF TG_OP = 'DELETE' THEN
      event_name := 'ticket_released';
    ELSE
      -- UPDATE on tickets is rare, treat as info update
      event_name := 'ticket_updated';
    END IF;
  ELSIF TG_TABLE_NAME = 'pending_tickets' THEN
    -- Pending tickets table: status-based events
    IF TG_OP = 'INSERT' THEN
      event_name := 'ticket_reserved';
    ELSIF TG_OP = 'UPDATE' THEN
      -- Check status transitions
      IF NEW.status = 'confirmed' AND OLD.status != 'confirmed' THEN
        event_name := 'ticket_sold';
      ELSIF NEW.status = 'expired' AND OLD.status != 'expired' THEN
        event_name := 'ticket_expired';
      ELSIF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
        event_name := 'ticket_released';
      ELSE
        event_name := 'reservation_updated';
      END IF;
    ELSIF TG_OP = 'DELETE' THEN
      event_name := 'ticket_released';
    END IF;
  END IF;

  -- Get current availability stats for the competition
  SELECT
    c.total_tickets,
    COALESCE((
      SELECT COUNT(*)::INTEGER FROM tickets t WHERE t.competition_id = v_competition_id
    ), 0),
    COALESCE((
      SELECT COUNT(*)::INTEGER FROM pending_tickets pt
      WHERE pt.competition_id = v_competition_id
        AND pt.status = 'pending'
        AND pt.expires_at > NOW()
    ), 0)
  INTO v_total_tickets, v_current_sold, v_current_pending
  FROM competitions c
  WHERE c.id = v_competition_id;

  -- Build the payload with ticket event data
  payload := jsonb_build_object(
    'event', event_name,
    'competition_id', v_competition_id,
    'timestamp', NOW(),
    'stats', jsonb_build_object(
      'total_tickets', COALESCE(v_total_tickets, 0),
      'sold_count', COALESCE(v_current_sold, 0),
      'pending_count', COALESCE(v_current_pending, 0),
      'available_count', GREATEST(0, COALESCE(v_total_tickets, 0) - COALESCE(v_current_sold, 0) - COALESCE(v_current_pending, 0))
    ),
    'change', jsonb_build_object(
      'ticket_count', v_ticket_count,
      'operation', TG_OP
    )
  );

  -- Add ticket numbers for relevant events (but not user-specific data for privacy)
  IF TG_TABLE_NAME = 'tickets' AND TG_OP = 'INSERT' THEN
    payload := payload || jsonb_build_object(
      'ticket_number', NEW.ticket_number
    );
  ELSIF TG_TABLE_NAME = 'pending_tickets' THEN
    -- Include ticket count but not specific numbers for privacy
    payload := payload || jsonb_build_object(
      'reserved_count', v_ticket_count
    );
  END IF;

  -- Use Supabase realtime broadcast
  BEGIN
    PERFORM pg_notify('realtime:broadcast', jsonb_build_object(
      'topic', topic_name,
      'event', event_name,
      'payload', payload,
      'private', FALSE
    )::text);
  EXCEPTION WHEN OTHERS THEN
    -- Log but don't fail if broadcast is not available
    RAISE NOTICE 'Could not broadcast ticket event: %', SQLERRM;
  END;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.broadcast_ticket_event IS
'Broadcasts ticket events to competition-specific channels for real-time UI updates.
Events: ticket_reserved, ticket_sold, ticket_released, ticket_expired
Topic format: competition:{competition_id}:tickets';


-- ============================================================================
-- Part 2: Create Triggers on tickets table
-- ============================================================================

-- Drop existing triggers if any
DROP TRIGGER IF EXISTS trigger_broadcast_ticket_sold ON public.tickets;
DROP TRIGGER IF EXISTS trigger_broadcast_ticket_deleted ON public.tickets;

-- Trigger for ticket INSERT (sold)
CREATE TRIGGER trigger_broadcast_ticket_sold
  AFTER INSERT ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_ticket_event();

-- Trigger for ticket DELETE (released - rare but possible)
CREATE TRIGGER trigger_broadcast_ticket_deleted
  AFTER DELETE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_ticket_event();


-- ============================================================================
-- Part 3: Create Triggers on pending_tickets table
-- ============================================================================

-- Drop existing triggers if any
DROP TRIGGER IF EXISTS trigger_broadcast_pending_ticket_insert ON public.pending_tickets;
DROP TRIGGER IF EXISTS trigger_broadcast_pending_ticket_update ON public.pending_tickets;
DROP TRIGGER IF EXISTS trigger_broadcast_pending_ticket_delete ON public.pending_tickets;

-- Trigger for pending ticket INSERT (reserved)
CREATE TRIGGER trigger_broadcast_pending_ticket_insert
  AFTER INSERT ON public.pending_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_ticket_event();

-- Trigger for pending ticket UPDATE (status changes: confirmed, expired, cancelled)
CREATE TRIGGER trigger_broadcast_pending_ticket_update
  AFTER UPDATE ON public.pending_tickets
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.broadcast_ticket_event();

-- Trigger for pending ticket DELETE (cleanup)
CREATE TRIGGER trigger_broadcast_pending_ticket_delete
  AFTER DELETE ON public.pending_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.broadcast_ticket_event();


-- ============================================================================
-- Part 4: RLS Policies for Realtime Authorization
-- ============================================================================

-- Note: Supabase Realtime uses a different authorization model than regular RLS.
-- For broadcast channels, we need to ensure proper authorization via:
-- 1. The channel being marked as private/public
-- 2. RLS on the underlying tables (which we already have)

-- The broadcast_ticket_event function uses SECURITY DEFINER to bypass RLS when
-- gathering stats, but the actual channel subscription is controlled by Supabase
-- Realtime's own authorization.

-- For competition-specific channels, we make them public (private: FALSE) because:
-- 1. Ticket availability is public information
-- 2. We don't expose user-specific data in the broadcast
-- 3. Anyone viewing a competition page should see real-time updates

-- If you need private channels (e.g., for user-specific ticket notifications),
-- create a separate function with private: TRUE and user-specific topic names.


-- ============================================================================
-- Part 5: Helper function to manually broadcast availability update
-- ============================================================================

CREATE OR REPLACE FUNCTION public.broadcast_competition_availability(
  p_competition_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  topic_name TEXT;
  payload JSONB;
  v_total_tickets INTEGER;
  v_sold_count INTEGER;
  v_pending_count INTEGER;
BEGIN
  -- Get competition stats
  SELECT
    c.total_tickets,
    COALESCE((
      SELECT COUNT(*)::INTEGER FROM tickets t WHERE t.competition_id = p_competition_id
    ), 0),
    COALESCE((
      SELECT COUNT(*)::INTEGER FROM pending_tickets pt
      WHERE pt.competition_id = p_competition_id
        AND pt.status = 'pending'
        AND pt.expires_at > NOW()
    ), 0)
  INTO v_total_tickets, v_sold_count, v_pending_count
  FROM competitions c
  WHERE c.id = p_competition_id;

  IF v_total_tickets IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Competition not found'
    );
  END IF;

  topic_name := 'competition:' || p_competition_id::TEXT || ':tickets';

  payload := jsonb_build_object(
    'event', 'availability_sync',
    'competition_id', p_competition_id,
    'timestamp', NOW(),
    'stats', jsonb_build_object(
      'total_tickets', v_total_tickets,
      'sold_count', v_sold_count,
      'pending_count', v_pending_count,
      'available_count', GREATEST(0, v_total_tickets - v_sold_count - v_pending_count)
    )
  );

  -- Broadcast the update
  BEGIN
    PERFORM pg_notify('realtime:broadcast', jsonb_build_object(
      'topic', topic_name,
      'event', 'availability_sync',
      'payload', payload,
      'private', FALSE
    )::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not broadcast availability: %', SQLERRM;
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
  END;

  RETURN jsonb_build_object(
    'success', true,
    'topic', topic_name,
    'stats', payload->'stats'
  );
END;
$$;

COMMENT ON FUNCTION public.broadcast_competition_availability IS
'Manually broadcasts current ticket availability for a competition.
Useful for forcing a sync or testing broadcast functionality.';

GRANT EXECUTE ON FUNCTION public.broadcast_competition_availability(UUID) TO service_role;


-- ============================================================================
-- Migration Complete Notice
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '============================================================';
  RAISE NOTICE 'Ticket Broadcast Triggers Migration Complete';
  RAISE NOTICE '============================================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Created Function:';
  RAISE NOTICE '  - broadcast_ticket_event() - Main broadcast trigger function';
  RAISE NOTICE '  - broadcast_competition_availability() - Manual sync helper';
  RAISE NOTICE '';
  RAISE NOTICE 'Created Triggers on tickets table:';
  RAISE NOTICE '  - trigger_broadcast_ticket_sold (AFTER INSERT)';
  RAISE NOTICE '  - trigger_broadcast_ticket_deleted (AFTER DELETE)';
  RAISE NOTICE '';
  RAISE NOTICE 'Created Triggers on pending_tickets table:';
  RAISE NOTICE '  - trigger_broadcast_pending_ticket_insert (AFTER INSERT)';
  RAISE NOTICE '  - trigger_broadcast_pending_ticket_update (AFTER UPDATE on status)';
  RAISE NOTICE '  - trigger_broadcast_pending_ticket_delete (AFTER DELETE)';
  RAISE NOTICE '';
  RAISE NOTICE 'Broadcast Events:';
  RAISE NOTICE '  - ticket_reserved: When tickets are held for checkout';
  RAISE NOTICE '  - ticket_sold: When tickets are confirmed/purchased';
  RAISE NOTICE '  - ticket_released: When reservation is cancelled';
  RAISE NOTICE '  - ticket_expired: When reservation expires';
  RAISE NOTICE '  - availability_sync: Manual full sync';
  RAISE NOTICE '';
  RAISE NOTICE 'Topic Format: competition:{competition_id}:tickets';
  RAISE NOTICE '============================================================';
END $$;
