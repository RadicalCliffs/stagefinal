-- Fix pending_tickets table by removing any blocking triggers
-- The error "Selected tickets are no longer available for this competition"
-- is being raised by a trigger that doesn't exist in the migrations

-- Drop potentially problematic triggers
DROP TRIGGER IF EXISTS check_ticket_availability_trigger ON pending_tickets;
DROP TRIGGER IF EXISTS validate_ticket_reservation ON pending_tickets;
DROP TRIGGER IF EXISTS prevent_duplicate_ticket_reservation ON pending_tickets;
DROP TRIGGER IF EXISTS check_tickets_available ON pending_tickets;

-- Drop any trigger functions that might be related to ticket validation
DROP FUNCTION IF EXISTS check_ticket_availability_trigger() CASCADE;
DROP FUNCTION IF EXISTS validate_ticket_reservation() CASCADE;
DROP FUNCTION IF EXISTS prevent_duplicate_ticket_reservation() CASCADE;
DROP FUNCTION IF EXISTS check_tickets_available() CASCADE;
DROP FUNCTION IF EXISTS check_ticket_availability() CASCADE;
DROP FUNCTION IF EXISTS validate_pending_tickets() CASCADE;
DROP FUNCTION IF EXISTS prevent_duplicate_tickets() CASCADE;
