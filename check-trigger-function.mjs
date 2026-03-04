import pg from "pg";
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

await client.connect();

const result = await client.query(`
  SELECT pg_get_functiondef(p.oid) as definition
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'trg_fn_confirm_pending_tickets'
`);

console.log("Current trigger function definition:");
console.log("====================================");
if (result.rows[0]) {
  const def = result.rows[0].definition;
  console.log(def);

  if (def.includes("FOREACH")) {
    console.log("\n❌ PROBLEM: Function still uses FOREACH loop (slow!)");
  } else if (def.includes("unnest")) {
    console.log("\n✅ GOOD: Function uses batch INSERT with unnest");
  }
} else {
  console.log("Function not found");
}

await client.end();
