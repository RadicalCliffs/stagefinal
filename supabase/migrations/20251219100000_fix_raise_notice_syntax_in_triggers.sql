-- Migration: Fix RAISE NOTICE syntax in broadcast_ticket_event trigger
-- This migration recreates the trigger function with correct syntax.
-- Simplified to avoid multi-statement parsing issues.

-- Part 1: Recreate broadcast_ticket_event with correct RAISE NOTICE syntax
CREATE OR REPLACE FUNCTION public.broadcast_ticket_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func_broadcast_ticket_event$
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
  IF TG_TABLE_NAME = 'tickets' THEN
    v_competition_id := COALESCE(NEW.competition_id, OLD.competition_id);
    v_ticket_count := 1;
  ELSIF TG_TABLE_NAME = 'pending_tickets' THEN
    v_competition_id := COALESCE(NEW.competition_id, OLD.competition_id);
    v_ticket_count := COALESCE(array_length(COALESCE(NEW.ticket_numbers, OLD.ticket_numbers), 1), 0);
  END IF;

  IF v_competition_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  topic_name := 'competition:' || v_competition_id::TEXT || ':tickets';

  IF TG_TABLE_NAME = 'tickets' THEN
    IF TG_OP = 'INSERT' THEN
      event_name := 'ticket_sold';
    ELSIF TG_OP = 'DELETE' THEN
      event_name := 'ticket_released';
    ELSE
      event_name := 'ticket_updated';
    END IF;
  ELSIF TG_TABLE_NAME = 'pending_tickets' THEN
    IF TG_OP = 'INSERT' THEN
      event_name := 'ticket_reserved';
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed' THEN
        event_name := 'ticket_sold';
      ELSIF NEW.status = 'expired' AND OLD.status IS DISTINCT FROM 'expired' THEN
        event_name := 'ticket_expired';
      ELSIF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
        event_name := 'ticket_released';
      ELSE
        event_name := 'reservation_updated';
      END IF;
    ELSIF TG_OP = 'DELETE' THEN
      event_name := 'ticket_released';
    END IF;
  END IF;

  SELECT
    c.total_tickets,
    COALESCE((SELECT COUNT(*)::INTEGER FROM tickets t WHERE t.competition_id = v_competition_id), 0),
    COALESCE((SELECT COUNT(*)::INTEGER FROM pending_tickets pt WHERE pt.competition_id = v_competition_id AND pt.status = 'pending' AND pt.expires_at > NOW()), 0)
  INTO v_total_tickets, v_current_sold, v_current_pending
  FROM competitions c
  WHERE c.id = v_competition_id;

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
    'change', jsonb_build_object('ticket_count', v_ticket_count, 'operation', TG_OP)
  );

  IF TG_TABLE_NAME = 'tickets' AND TG_OP = 'INSERT' THEN
    payload := payload || jsonb_build_object('ticket_number', NEW.ticket_number);
  ELSIF TG_TABLE_NAME = 'pending_tickets' THEN
    payload := payload || jsonb_build_object('reserved_count', v_ticket_count);
  END IF;

  BEGIN
    PERFORM pg_notify('realtime:broadcast', jsonb_build_object('topic', topic_name, 'event', event_name, 'payload', payload, 'private', FALSE)::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'broadcast_ticket_event: pg_notify failed: %', SQLERRM;
  END;

  RETURN COALESCE(NEW, OLD);
END;
$func_broadcast_ticket_event$;
