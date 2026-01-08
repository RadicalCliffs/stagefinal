-- Part 4: Fix tickets table RLS for SELECT operations

DROP POLICY IF EXISTS "Public can view tickets" ON tickets;
DROP POLICY IF EXISTS "Anyone can view tickets for availability" ON tickets;
DROP POLICY IF EXISTS "Users can view own tickets" ON tickets;

CREATE POLICY "Anyone can view tickets for availability"
  ON tickets FOR SELECT
  USING (true);

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
