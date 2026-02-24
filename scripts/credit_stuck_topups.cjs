/**
 * Credit all stuck topups that have no ledger entry
 * Uses the idempotent credit_balance_with_first_deposit_bonus function
 */
const { Client } = require("pg");

async function creditStuckTopups() {
  const client = new Client({
    host: "aws-1-ap-south-1.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    user: "postgres.mthwfldcjvpxjtmrqkqm",
    password: "LetsF4ckenGo!",
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("=== CREDITING ALL STUCK TOPUPS ===\n");

  try {
    // Get all stuck topups
    const stuck = await client.query(`
      SELECT 
        ut.id,
        ut.canonical_user_id,
        ut.amount,
        ut.payment_provider,
        ut.tx_id
      FROM user_transactions ut
      LEFT JOIN balance_ledger bl ON bl.reference_id = ut.tx_id
      WHERE (ut.status = 'completed' OR ut.payment_status = 'completed')
        AND ut.type = 'topup'
        AND (ut.posted_to_balance = false OR ut.posted_to_balance IS NULL)
        AND bl.id IS NULL
        AND ut.canonical_user_id IS NOT NULL
      ORDER BY ut.created_at
    `);

    console.log(`Found ${stuck.rowCount} stuck topups to credit\n`);

    let credited = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of stuck.rows) {
      // Generate a reference_id if tx_id is null
      const referenceId = row.tx_id || `manual_credit_${row.id}`;

      try {
        // Call the idempotent credit function
        const result = await client.query(
          `
          SELECT credit_balance_with_first_deposit_bonus(
            $1::text,
            $2::numeric,
            $3::text,
            $4::text
          ) as result
        `,
          [
            row.canonical_user_id,
            row.amount,
            `Reconciliation for stuck ${row.payment_provider} topup`,
            referenceId,
          ],
        );

        const creditResult = result.rows[0]?.result;

        if (creditResult?.already_credited) {
          console.log(
            `SKIP: $${row.amount} for ${row.canonical_user_id.substring(0, 30)}... (already credited)`,
          );
          skipped++;
        } else if (creditResult?.success) {
          console.log(
            `✅ Credited $${row.amount} to ${row.canonical_user_id.substring(0, 30)}... (bonus: $${creditResult.bonus_amount || 0})`,
          );
          credited++;

          // Mark the transaction as posted
          await client.query(
            `
            UPDATE user_transactions 
            SET posted_to_balance = true, 
                payment_provider = 'cdp_commerce',
                updated_at = NOW(),
                notes = COALESCE(notes, '') || ' | Reconciled ' || NOW()::text
            WHERE id = $1
          `,
            [row.id],
          );
        } else {
          console.log(
            `❌ Failed: $${row.amount} for ${row.canonical_user_id.substring(0, 30)}...`,
          );
          failed++;
        }
      } catch (err) {
        console.log(
          `❌ Error: $${row.amount} for ${row.canonical_user_id?.substring(0, 30)}... - ${err.message}`,
        );
        failed++;
      }
    }

    console.log(`\n=== SUMMARY ===`);
    console.log(`Credited: ${credited}`);
    console.log(`Skipped (already done): ${skipped}`);
    console.log(`Failed: ${failed}`);

    // Handle NULL canonical_user_id rows separately
    const nullUsers = await client.query(`
      SELECT COUNT(*) as cnt
      FROM user_transactions ut
      LEFT JOIN balance_ledger bl ON bl.reference_id = ut.tx_id
      WHERE (ut.status = 'completed' OR ut.payment_status = 'completed')
        AND ut.type = 'topup'
        AND (ut.posted_to_balance = false OR ut.posted_to_balance IS NULL)
        AND bl.id IS NULL
        AND ut.canonical_user_id IS NULL
    `);

    if (parseInt(nullUsers.rows[0].cnt) > 0) {
      console.log(
        `\n⚠️  ${nullUsers.rows[0].cnt} stuck topups have NULL canonical_user_id - cannot credit automatically`,
      );
    }
  } finally {
    await client.end();
  }
}

creditStuckTopups().catch(console.error);
