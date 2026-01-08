-- Part 1: Create competition_winners view for frontend compatibility

-- Drop as TABLE first (if it exists as table), then as VIEW
DROP TABLE IF EXISTS competition_winners CASCADE;
DROP VIEW IF EXISTS competition_winners;

CREATE VIEW competition_winners AS
SELECT
  w.id,
  c.prize_value AS competitionprize,
  w.wallet_address AS "Winner",
  w.crdate AS "crDate",
  c.title AS competitionname,
  c.image_url AS imageurl,
  c.id::text AS competitionid,
  w.prize_tx_hash AS txhash,
  w.ticket_number,
  w.prize_distributed,
  w.user_id
FROM winners w
LEFT JOIN competitions c ON w.competition_id = c.id;
