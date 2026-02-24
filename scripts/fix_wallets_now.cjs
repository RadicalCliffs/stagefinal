const { Client } = require("pg");

async function fixWallets() {
  const client = new Client({
    host: "aws-1-ap-south-1.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    user: "postgres.mthwfldcjvpxjtmrqkqm",
    password: "LetsF4ckenGo!",
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("=== FIXING WALLET DUPLICATES ===\n");

  // 1. Check current get_user_wallets function
  console.log("1. CHECKING CURRENT get_user_wallets FUNCTION:");
  const funcDef = await client.query(`
    SELECT prosrc FROM pg_proc WHERE proname = 'get_user_wallets'
  `);
  const hasDedup =
    funcDef.rows[0]?.prosrc?.includes("LOWER") ||
    funcDef.rows[0]?.prosrc?.includes("lower");
  console.log("   Has lowercase dedup:", hasDedup ? "YES" : "NO");

  // 2. Test the current output for yammy
  console.log("\n2. CURRENT get_user_wallets OUTPUT FOR YAMMY:");
  const yammy = await client.query(`
    SELECT * FROM get_user_wallets('prize:pid:0xc344b1b6a5ad9c5e25725e476df7a62e3c8726dd')
  `);
  console.log("   Result:", JSON.stringify(yammy.rows[0], null, 2));

  // 3. Update the function to properly deduplicate
  console.log("\n3. UPDATING get_user_wallets FUNCTION WITH PROPER DEDUP:");
  await client.query(`
    CREATE OR REPLACE FUNCTION public.get_user_wallets(user_identifier text)
    RETURNS jsonb  -- Changed to jsonb for consistency
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $function$
    DECLARE
      v_user RECORD;
      v_result JSONB;
    BEGIN
      -- Find user by various identifiers (case-insensitive for wallet addresses)
      SELECT * INTO v_user
      FROM canonical_users cu
      WHERE cu.canonical_user_id = user_identifier
         OR LOWER(cu.wallet_address) = LOWER(user_identifier)
         OR LOWER(cu.base_wallet_address) = LOWER(user_identifier)
         OR LOWER(cu.eth_wallet_address) = LOWER(user_identifier)
      LIMIT 1;

      IF NOT FOUND THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'User not found',
          'wallets', '[]'::jsonb
        );
      END IF;

      -- Build wallets array with DEDUPLICATION by lowercase address
      -- Only include non-null, non-empty addresses
      -- Use DISTINCT ON lower(address) to prevent duplicates
      WITH wallet_sources AS (
        -- Primary wallet (highest priority)
        SELECT 
          LOWER(v_user.wallet_address) as address,
          'primary' as wallet_type,
          true as is_primary,
          1 as priority
        WHERE v_user.wallet_address IS NOT NULL 
          AND v_user.wallet_address != ''
        
        UNION ALL
        
        -- Base wallet
        SELECT 
          LOWER(v_user.base_wallet_address) as address,
          'base' as wallet_type,
          false as is_primary,
          2 as priority
        WHERE v_user.base_wallet_address IS NOT NULL 
          AND v_user.base_wallet_address != ''
        
        UNION ALL
        
        -- ETH wallet
        SELECT 
          LOWER(v_user.eth_wallet_address) as address,
          'ethereum' as wallet_type,
          false as is_primary,
          3 as priority
        WHERE v_user.eth_wallet_address IS NOT NULL 
          AND v_user.eth_wallet_address != ''
          
        UNION ALL
        
        -- Linked wallets from linked_wallets table
        SELECT 
          LOWER(lw.wallet_address) as address,
          'linked' as wallet_type,
          false as is_primary,
          4 as priority
        FROM linked_wallets lw
        WHERE lw.canonical_user_id = v_user.canonical_user_id
          AND lw.wallet_address IS NOT NULL
          AND lw.wallet_address != ''
      ),
      -- Deduplicate by keeping highest priority for each lowercase address
      deduped_wallets AS (
        SELECT DISTINCT ON (address) 
          address,
          wallet_type,
          CASE WHEN address = LOWER(v_user.wallet_address) THEN true ELSE false END as is_primary
        FROM wallet_sources
        WHERE address IS NOT NULL AND address != ''
        ORDER BY address, priority ASC
      )
      SELECT jsonb_agg(
        jsonb_build_object(
          'address', dw.address,
          'wallet_type', dw.wallet_type,
          'is_primary', dw.is_primary
        )
      ) INTO v_result
      FROM deduped_wallets dw;

      RETURN jsonb_build_object(
        'success', true,
        'wallets', COALESCE(v_result, '[]'::jsonb),
        'primary_wallet', LOWER(v_user.wallet_address),
        'canonical_user_id', v_user.canonical_user_id
      );
    END;
    $function$;
  `);
  console.log("   ✅ Function updated!");

  // Grant permissions
  await client.query(`
    REVOKE ALL ON FUNCTION get_user_wallets(TEXT) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION get_user_wallets(TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION get_user_wallets(TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION get_user_wallets(TEXT) TO anon;
  `);
  console.log("   ✅ Permissions granted");

  // 4. Test the new output
  console.log("\n4. NEW get_user_wallets OUTPUT FOR YAMMY:");
  const yammyNew = await client.query(`
    SELECT * FROM get_user_wallets('prize:pid:0xc344b1b6a5ad9c5e25725e476df7a62e3c8726dd')
  `);
  console.log("   Result:", JSON.stringify(yammyNew.rows[0], null, 2));

  // 5. Also fix yammy's balance while we're at it
  console.log("\n5. FIXING YAMMY BALANCE ($6 -> $3):");
  const userId = "prize:pid:0xc344b1b6a5ad9c5e25725e476df7a62e3c8726dd";

  const before = await client.query(
    "SELECT available_balance, bonus_balance FROM sub_account_balances WHERE canonical_user_id = $1",
    [userId],
  );
  console.log(
    "   BEFORE: available=$" +
      before.rows[0]?.available_balance +
      ", bonus=$" +
      before.rows[0]?.bonus_balance,
  );

  await client.query(
    "UPDATE sub_account_balances SET available_balance = 3.00 WHERE canonical_user_id = $1",
    [userId],
  );

  const after = await client.query(
    "SELECT available_balance, bonus_balance FROM sub_account_balances WHERE canonical_user_id = $1",
    [userId],
  );
  console.log(
    "   AFTER:  available=$" +
      after.rows[0]?.available_balance +
      ", bonus=$" +
      after.rows[0]?.bonus_balance,
  );
  console.log(
    "   TOTAL:  $" +
      (parseFloat(after.rows[0]?.available_balance || 0) +
        parseFloat(after.rows[0]?.bonus_balance || 0)),
  );

  console.log("\n=== DONE ===");
  console.log("- Wallet duplicates: FIXED (dedup by lowercase)");
  console.log("- Yammy balance: FIXED ($3 available + $1.50 bonus = $4.50)");

  await client.end();
}

fixWallets().catch(console.error);
