const { Client } = require("pg");

async function fix() {
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

  // Update the function with simpler logic
  console.log("1. UPDATING get_user_wallets FUNCTION:");
  await client.query(`
    CREATE OR REPLACE FUNCTION public.get_user_wallets(user_identifier text)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $func$
    DECLARE
      v_user RECORD;
      v_wallets JSONB := '[]'::jsonb;
      v_seen_addresses TEXT[] := ARRAY[]::TEXT[];
      v_addr TEXT;
    BEGIN
      SELECT * INTO v_user
      FROM canonical_users cu
      WHERE cu.canonical_user_id = user_identifier
         OR LOWER(cu.wallet_address) = LOWER(user_identifier)
         OR LOWER(cu.base_wallet_address) = LOWER(user_identifier)
         OR LOWER(cu.eth_wallet_address) = LOWER(user_identifier)
      LIMIT 1;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found', 'wallets', '[]'::jsonb);
      END IF;

      -- Add primary wallet first
      IF v_user.wallet_address IS NOT NULL AND v_user.wallet_address != '' THEN
        v_addr := LOWER(v_user.wallet_address);
        v_wallets := v_wallets || jsonb_build_object('address', v_addr, 'wallet_type', 'primary', 'is_primary', true);
        v_seen_addresses := array_append(v_seen_addresses, v_addr);
      END IF;

      -- Add base wallet if not duplicate
      IF v_user.base_wallet_address IS NOT NULL AND v_user.base_wallet_address != '' THEN
        v_addr := LOWER(v_user.base_wallet_address);
        IF NOT v_addr = ANY(v_seen_addresses) THEN
          v_wallets := v_wallets || jsonb_build_object('address', v_addr, 'wallet_type', 'base', 'is_primary', false);
          v_seen_addresses := array_append(v_seen_addresses, v_addr);
        END IF;
      END IF;

      -- Add eth wallet if not duplicate
      IF v_user.eth_wallet_address IS NOT NULL AND v_user.eth_wallet_address != '' THEN
        v_addr := LOWER(v_user.eth_wallet_address);
        IF NOT v_addr = ANY(v_seen_addresses) THEN
          v_wallets := v_wallets || jsonb_build_object('address', v_addr, 'wallet_type', 'ethereum', 'is_primary', false);
        END IF;
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'wallets', v_wallets,
        'primary_wallet', LOWER(COALESCE(v_user.wallet_address, '')),
        'canonical_user_id', v_user.canonical_user_id
      );
    END;
    $func$;
  `);
  console.log("   ✅ Function updated with dedup logic!");

  // Grant permissions
  await client.query(`
    REVOKE ALL ON FUNCTION get_user_wallets(TEXT) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION get_user_wallets(TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION get_user_wallets(TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION get_user_wallets(TEXT) TO anon;
  `);
  console.log("   ✅ Permissions granted");

  // Test the function
  console.log("\n2. TESTING get_user_wallets:");
  const result = await client.query(`
    SELECT * FROM get_user_wallets('prize:pid:0xc344b1b6a5ad9c5e25725e476df7a62e3c8726dd')
  `);
  console.log(
    "   Result:",
    JSON.stringify(result.rows[0].get_user_wallets, null, 2),
  );

  // Fix yammy's balance
  console.log("\n3. FIXING YAMMY BALANCE ($6 -> $3):");
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

  await client.end();
}

fix().catch(console.error);
