const { Client } = require("pg");

const client = new Client({
  host: "aws-1-ap-south-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  user: "postgres.mthwfldcjvpxjtmrqkqm",
  password: "LetsF4ckenGo!",
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    await client.connect();
    console.log("=".repeat(80));
    console.log("WALLET & BALANCE INVESTIGATION FOR 0x0ff51E...");
    console.log("=".repeat(80));

    // 1. Find user by wallet address
    const wallet = "0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

    console.log("\n📊 CANONICAL_USERS:");
    const cuResult = await client.query(
      `
      SELECT canonical_user_id, username, wallet_address, base_wallet_address, eth_wallet_address, avatar_url
      FROM canonical_users
      WHERE wallet_address ILIKE $1
         OR base_wallet_address ILIKE $1
         OR canonical_user_id ILIKE '%' || $1
    `,
      [wallet],
    );
    console.log(JSON.stringify(cuResult.rows, null, 2));

    const cuid = cuResult.rows[0]?.canonical_user_id;
    console.log("\nCanonical User ID:", cuid);

    // 2. Check sub_account_balances
    console.log("\n📊 SUB_ACCOUNT_BALANCES:");
    const sabResult = await client.query(
      `
      SELECT * FROM sub_account_balances
      WHERE canonical_user_id = $1
         OR canonical_user_id ILIKE '%' || $2
         OR wallet_address ILIKE $2
    `,
      [cuid, wallet],
    );
    console.log(JSON.stringify(sabResult.rows, null, 2));

    // 3. Check balance_ledger recent entries
    console.log("\n📊 BALANCE_LEDGER (last 10):");
    const blResult = await client.query(
      `
      SELECT id, transaction_type, amount, balance_before, balance_after, created_at, description
      FROM balance_ledger
      WHERE canonical_user_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `,
      [cuid],
    );
    console.log(JSON.stringify(blResult.rows, null, 2));

    // 4. Check user_transactions
    console.log("\n📊 USER_TRANSACTIONS (last 10):");
    const utResult = await client.query(
      `
      SELECT id, type, amount, status, payment_status, created_at
      FROM user_transactions
      WHERE canonical_user_id = $1
         OR wallet_address ILIKE $2
      ORDER BY created_at DESC
      LIMIT 10
    `,
      [cuid, wallet],
    );
    console.log(JSON.stringify(utResult.rows, null, 2));

    // 5. Check for duplicate canonical_users entries
    console.log("\n📊 CHECK FOR DUPLICATES:");
    const dupResult = await client.query(
      `
      SELECT canonical_user_id, wallet_address, base_wallet_address, username
      FROM canonical_users
      WHERE wallet_address ILIKE $1
         OR base_wallet_address ILIKE $1
         OR eth_wallet_address ILIKE $1
    `,
      [wallet],
    );
    console.log("Users with this wallet:", dupResult.rowCount);
    console.log(JSON.stringify(dupResult.rows, null, 2));

    // 6. Check get_user_wallets RPC result
    console.log("\n📊 GET_USER_WALLETS RPC:");
    try {
      const rpcResult = await client.query(
        `
        SELECT * FROM get_user_wallets($1)
      `,
        [cuid],
      );
      console.log(JSON.stringify(rpcResult.rows, null, 2));
    } catch (e) {
      console.log("RPC get_user_wallets error:", e.message);
    }

    console.log("\n" + "=".repeat(80));
    console.log("INVESTIGATION COMPLETE");
    console.log("=".repeat(80));
  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err.stack);
  } finally {
    await client.end();
  }
})();
