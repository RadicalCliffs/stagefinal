const { Client } = require("pg");
const c = new Client({
  host: "aws-1-ap-south-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  user: "postgres.mthwfldcjvpxjtmrqkqm",
  password: "LetsF4ckenGo!",
  ssl: { rejectUnauthorized: false },
});

(async () => {
  await c.connect();

  const tables = [
    "balance_ledger",
    "joincompetition",
    "user_transactions",
    "orders",
    "tickets",
  ];
  for (const table of tables) {
    const r = await c.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`,
      [table],
    );
    console.log(`\n${table.toUpperCase()} columns:`);
    console.log("  " + r.rows.map((x) => x.column_name).join(", "));
  }

  // Check tx_ref column specifics
  console.log("\n\nUSER_TRANSACTIONS.tx_ref details:");
  const txRef = await c.query(`
    SELECT column_name, column_default, is_nullable, data_type, is_generated
    FROM information_schema.columns 
    WHERE table_name='user_transactions' AND column_name='tx_ref'
  `);
  console.log(JSON.stringify(txRef.rows[0], null, 2));

  // Check if it's a generated column
  const genCol = await c.query(`
    SELECT attname, attgenerated
    FROM pg_attribute 
    WHERE attrelid = 'user_transactions'::regclass 
      AND attname = 'tx_ref'
  `);
  console.log(
    "\npg_attribute (generated):",
    JSON.stringify(genCol.rows[0], null, 2),
  );

  await c.end();
})();
