import pg from "pg";
import fs from "fs";
const { Client } = pg;

const client = new Client({
  host: "aws-1-ap-south-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  user: "postgres.mthwfldcjvpxjtmrqkqm",
  password: "iamclaudeandiamafuckingretard",
  ssl: { rejectUnauthorized: false },
});

async function runRecalculation() {
  try {
    console.log(
      "\n⚠️  WARNING: This will recalculate ALL finished competition winners",
    );
    console.log(
      "Winners may change if they were drawn with a different algorithm\n",
    );

    await client.connect();
    console.log("✅ Connected to database\n");
    console.log("Reading SQL file...");

    const sql = fs.readFileSync("RECALCULATE_ALL_WINNERS_SHA256.sql", "utf8");

    console.log("Executing recalculation...\n");

    const result = await client.query(sql);

    console.log("\n✅ Recalculation complete!");
    console.log("All competitions now use SHA256 algorithm consistently\n");
  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err.stack);
  } finally {
    await client.end();
  }
}

runRecalculation();
