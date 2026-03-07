import pg from "pg";
const { Client } = pg;

const client = new Client({
  host: "aws-1-ap-south-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  user: "postgres.mthwfldcjvpxjtmrqkqm",
  password: "iamclaudeandiamafuckingretard",
  ssl: { rejectUnauthorized: false },
});

async function checkTicket1() {
  try {
    await client.connect();
    console.log("=== CHECKING TICKET #1 FOR $1000 ===\n");

    const compId = "98ea9cbc-5d9b-409b-b757-acb9d0292a95";

    const result = await client.query(
      `
      SELECT * FROM tickets 
      WHERE competition_id = $1 AND ticket_number = 1
    `,
      [compId],
    );

    if (result.rows.length > 0) {
      console.log("Ticket #1 data:");
      console.log(JSON.stringify(result.rows[0], null, 2));
    } else {
      console.log("❌ Ticket #1 not found");
    }

    await client.end();
  } catch (error) {
    console.error("❌ Error:", error.message);
    await client.end();
  }
}

checkTicket1();
