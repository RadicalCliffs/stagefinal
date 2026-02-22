/**
 * Fix wallet balance display issues:
 * 1. Consolidate duplicate sub_account_balances records
 * 2. Fix get_user_wallets RPC to return wallets array properly
 */

const { Client } = require("pg");

const connectionString =
  "postgresql://postgres.mthwfldcjvpxjtmrqkqm:LetsF4ckenGo!@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require";

async function main() {
  const client = new Client({ connectionString });
  await client.connect();

  console.log("\n" + "=".length, "WALLET BALANCE FIX");
  console.log("=".repeat(80));

  try {
    // STEP 1: Get current get_user_wallets RPC definition
    console.log("\n📋 STEP 1: Current get_user_wallets RPC definition:\n");

    const rpcDef = await client.query(`
      SELECT routine_name, routine_definition 
      FROM information_schema.routines 
      WHERE routine_name = 'get_user_wallets' 
      AND routine_schema = 'public'
    `);

    if (rpcDef.rows.length > 0) {
      console.log(rpcDef.rows[0].routine_definition.substring(0, 2000) + "...");
    }

    // STEP 2: Find ALL duplicate sub_account_balances (not just 0x0ff51E)
    console.log("\n📋 STEP 2: Finding ALL duplicate sub_account_balances...\n");

    const duplicates = await client.query(`
      WITH normalized AS (
        SELECT 
          id,
          user_id,
          canonical_user_id,
          wallet_address,
          available_balance,
          LOWER(
            CASE 
              WHEN canonical_user_id LIKE 'prize:pid:%' THEN SUBSTRING(canonical_user_id FROM 11)
              WHEN canonical_user_id ~ '^0x[a-fA-F0-9]{40}$' THEN canonical_user_id
              WHEN wallet_address ~ '^0x[a-fA-F0-9]{40}$' THEN wallet_address
              WHEN user_id ~ '^0x[a-fA-F0-9]{40}$' THEN user_id
              ELSE NULL
            END
          ) as normalized_wallet
        FROM sub_account_balances
      )
      SELECT 
        normalized_wallet,
        COUNT(*) as count,
        ARRAY_AGG(id) as ids,
        ARRAY_AGG(user_id) as user_ids,
        ARRAY_AGG(available_balance) as balances
      FROM normalized
      WHERE normalized_wallet IS NOT NULL
      GROUP BY normalized_wallet
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `);

    console.log(
      `Found ${duplicates.rows.length} wallets with duplicate balance records:`,
    );
    for (const row of duplicates.rows) {
      console.log(
        `  - ${row.normalized_wallet}: ${row.count} records, balances: ${row.balances.join(", ")}`,
      );
    }

    // STEP 3: For each duplicate, keep the canonical one and delete the rest
    console.log("\n📋 STEP 3: Consolidating duplicate balance records...\n");

    for (const dup of duplicates.rows) {
      console.log(`\nProcessing wallet: ${dup.normalized_wallet}`);

      // Find the canonical record (with prize:pid: prefix in user_id)
      const records = await client.query(
        `
        SELECT id, user_id, canonical_user_id, wallet_address, available_balance, username
        FROM sub_account_balances
        WHERE LOWER(canonical_user_id) LIKE '%' || $1 || '%'
           OR LOWER(user_id) LIKE '%' || $1 || '%'
           OR LOWER(wallet_address) = $1
        ORDER BY 
          CASE WHEN user_id LIKE 'prize:pid:%' THEN 0 ELSE 1 END,
          available_balance::numeric DESC
      `,
        [dup.normalized_wallet],
      );

      console.log(`  Found ${records.rows.length} records:`);
      records.rows.forEach((r, i) => {
        console.log(
          `    ${i + 1}. id=${r.id.substring(0, 8)}..., user_id=${r.user_id.substring(0, 30)}..., balance=$${r.available_balance}, username=${r.username || "NULL"}`,
        );
      });

      if (records.rows.length <= 1) continue;

      // Keep the first one (canonical/highest balance), delete the rest
      const keepRecord = records.rows[0];
      const deleteRecords = records.rows.slice(1);

      console.log(
        `  Keeping: ${keepRecord.id} (${keepRecord.user_id.substring(0, 30)}...) with $${keepRecord.available_balance}`,
      );

      for (const del of deleteRecords) {
        console.log(
          `  Deleting: ${del.id} (${del.user_id.substring(0, 30)}...) with $${del.available_balance}`,
        );
        await client.query("DELETE FROM sub_account_balances WHERE id = $1", [
          del.id,
        ]);
      }
    }

    // STEP 4: Create improved get_user_wallets RPC
    console.log(
      "\n📋 STEP 4: Updating get_user_wallets RPC to return wallets array...\n",
    );

    const newRpc = `
CREATE OR REPLACE FUNCTION public.get_user_wallets(user_identifier text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  user_record RECORD;
  wallets_array jsonb := '[]'::jsonb;
BEGIN
  -- Find the user in canonical_users
  SELECT * INTO user_record
  FROM canonical_users
  WHERE canonical_user_id = user_identifier
     OR LOWER(canonical_user_id) = LOWER(user_identifier)
     OR wallet_address = user_identifier
     OR LOWER(wallet_address) = LOWER(user_identifier)
  LIMIT 1;

  IF user_record IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'User not found',
      'wallets', '[]'::jsonb,
      'primary_wallet', NULL
    );
  END IF;

  -- Build wallets array from the user's wallet addresses
  IF user_record.wallet_address IS NOT NULL THEN
    wallets_array := wallets_array || jsonb_build_object(
      'wallet_address', user_record.wallet_address,
      'chain', 'base',
      'is_primary', true,
      'nickname', COALESCE(user_record.username, 'Primary Wallet')
    );
  END IF;

  -- Add ETH wallet if different from base wallet
  IF user_record.eth_wallet_address IS NOT NULL 
     AND user_record.eth_wallet_address != user_record.wallet_address THEN
    wallets_array := wallets_array || jsonb_build_object(
      'wallet_address', user_record.eth_wallet_address,
      'chain', 'ethereum',
      'is_primary', false,
      'nickname', 'Ethereum Wallet'
    );
  END IF;

  -- Add Base wallet if different
  IF user_record.base_wallet_address IS NOT NULL 
     AND user_record.base_wallet_address != user_record.wallet_address
     AND user_record.base_wallet_address != user_record.eth_wallet_address THEN
    wallets_array := wallets_array || jsonb_build_object(
      'wallet_address', user_record.base_wallet_address,
      'chain', 'base',
      'is_primary', false,
      'nickname', 'Base Wallet'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'wallets', wallets_array,
    'primary_wallet', user_record.wallet_address,
    'wallet_address', user_record.wallet_address,
    'eth_wallet_address', user_record.eth_wallet_address,
    'base_wallet_address', user_record.base_wallet_address
  );
END;
$$;
`;

    await client.query(newRpc);
    console.log("✅ Updated get_user_wallets RPC");

    // STEP 5: Test the updated RPC
    console.log("\n📋 STEP 5: Testing updated RPC for 0x0ff51E...\n");

    const testResult = await client.query(`
      SELECT get_user_wallets('prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363')
    `);

    console.log(
      "RPC Result:",
      JSON.stringify(testResult.rows[0].get_user_wallets, null, 2),
    );

    // STEP 6: Verify no more duplicates
    console.log(
      "\n📋 STEP 6: Verifying no more duplicate sub_account_balances...\n",
    );

    const checkDup = await client.query(`
      WITH normalized AS (
        SELECT 
          LOWER(
            CASE 
              WHEN canonical_user_id LIKE 'prize:pid:%' THEN SUBSTRING(canonical_user_id FROM 11)
              WHEN canonical_user_id ~ '^0x[a-fA-F0-9]{40}$' THEN canonical_user_id
              WHEN wallet_address ~ '^0x[a-fA-F0-9]{40}$' THEN wallet_address
              WHEN user_id ~ '^0x[a-fA-F0-9]{40}$' THEN user_id
              ELSE NULL
            END
          ) as normalized_wallet
        FROM sub_account_balances
      )
      SELECT normalized_wallet, COUNT(*) as count
      FROM normalized
      WHERE normalized_wallet IS NOT NULL
      GROUP BY normalized_wallet
      HAVING COUNT(*) > 1
    `);

    if (checkDup.rows.length === 0) {
      console.log("✅ No more duplicate balance records!");
    } else {
      console.log(
        `⚠️ Still have ${checkDup.rows.length} wallets with duplicates`,
      );
    }

    // STEP 7: Check jerry's balance is correct
    console.log("\n📋 STEP 7: Verifying jerry (0x0ff51E) balance...\n");

    const jerryBalance = await client.query(`
      SELECT user_id, canonical_user_id, available_balance, username, wallet_address
      FROM sub_account_balances
      WHERE LOWER(canonical_user_id) LIKE '%0x0ff51ec0ecc9ae1e5e6048976ba307c849781363%'
         OR LOWER(user_id) LIKE '%0x0ff51ec0ecc9ae1e5e6048976ba307c849781363%'
         OR LOWER(wallet_address) = '0x0ff51ec0ecc9ae1e5e6048976ba307c849781363'
    `);

    console.log("Jerry balance records:", jerryBalance.rows.length);
    jerryBalance.rows.forEach((r) => {
      console.log(`  - user_id: ${r.user_id.substring(0, 40)}...`);
      console.log(
        `    canonical_user_id: ${r.canonical_user_id?.substring(0, 40) || "NULL"}...`,
      );
      console.log(`    available_balance: $${r.available_balance}`);
      console.log(`    username: ${r.username || "NULL"}`);
      console.log(`    wallet_address: ${r.wallet_address || "NULL"}`);
    });

    console.log("\n" + "=".repeat(80));
    console.log("FIX COMPLETE");
    console.log("=".repeat(80));
  } catch (err) {
    console.error("ERROR:", err);
  } finally {
    await client.end();
  }
}

main();
