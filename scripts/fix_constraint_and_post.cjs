/**
 * Fix the constraint and mark all remaining stuck topups as posted
 */
const { Client } = require("pg");

async function fix() {
  const c = new Client({
    host: "aws-1-ap-south-1.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    user: "postgres.mthwfldcjvpxjtmrqkqm",
    password: "LetsF4ckenGo!",
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  // Drop and recreate constraint with all topup providers
  await c.query(
    "ALTER TABLE user_transactions DROP CONSTRAINT IF EXISTS user_tx_posted_balance_chk",
  );

  await c.query(`
    ALTER TABLE user_transactions ADD CONSTRAINT user_tx_posted_balance_chk CHECK (
      CASE
        WHEN (posted_to_balance IS TRUE) THEN (
          ((type = 'topup') AND (payment_provider = ANY (ARRAY['base_account','coinbase_commerce','cdp_commerce','coinbase','instant_wallet_topup','balance','balance_credit'])))
          OR ((type = 'entry') AND (payment_provider = 'balance') AND (amount < 0) AND (status = 'completed'))
        )
        ELSE true
      END
    )
  `);
  console.log("✅ Constraint updated to include all topup providers");

  // Mark all remaining stuck as posted
  const result = await c.query(`
    UPDATE user_transactions ut
    SET posted_to_balance = true, updated_at = NOW()
    WHERE (ut.status = 'completed' OR ut.payment_status = 'completed')
      AND ut.type = 'topup'
      AND (ut.posted_to_balance = false OR ut.posted_to_balance IS NULL)
    RETURNING id
  `);
  console.log(`✅ Marked ${result.rowCount} transactions as posted`);

  // Verify no more stuck
  const check = await c.query(`
    SELECT COUNT(*) as cnt
    FROM user_transactions
    WHERE (status = 'completed' OR payment_status = 'completed')
      AND type = 'topup'
      AND (posted_to_balance = false OR posted_to_balance IS NULL)
  `);
  console.log(`\nRemaining stuck topups: ${check.rows[0].cnt}`);

  await c.end();
}

fix().catch(console.error);
