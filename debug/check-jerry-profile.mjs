import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  host: "aws-0-ap-south-1.pooler.supabase.com",
  port: 5432,
  database: "postgres",
  user: "postgres.mthwfldcjvpxjtmrqkqm",
  password: "mINEr00m881!",
  ssl: { rejectUnauthorized: false },
});

async function checkProfile() {
  const client = await pool.connect();
  try {
    const walletAddress = "0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";

    console.log("\n=== CHECKING PROFILE FOR WINNER ===");
    console.log(`Wallet: ${walletAddress}\n`);

    // Check profiles table
    const profileResult = await client.query(
      `
      SELECT wallet_address, username, display_name, created_at
      FROM profiles
      WHERE wallet_address = $1
    `,
      [walletAddress],
    );

    console.log("PROFILES TABLE:");
    if (profileResult.rows.length > 0) {
      console.log(JSON.stringify(profileResult.rows[0], null, 2));
    } else {
      console.log("❌ No profile found for this wallet");
    }

    // Check lowercase version
    const lowerResult = await client.query(
      `
      SELECT wallet_address, username, display_name, created_at
      FROM profiles
      WHERE LOWER(wallet_address) = LOWER($1)
    `,
      [walletAddress],
    );

    console.log("\nPROFILES TABLE (case-insensitive):");
    if (lowerResult.rows.length > 0) {
      console.log(JSON.stringify(lowerResult.rows[0], null, 2));
    } else {
      console.log("❌ No profile found (case-insensitive)");
    }

    // Check winners table for username
    const winnersResult = await client.query(`
      SELECT wallet_address, username, user_id, ticket_number
      FROM winners
      WHERE competition_id = '98ea9cbc-5d9b-409b-b757-acb9d0292a95'
    `);

    console.log("\nWINNERS TABLE:");
    if (winnersResult.rows.length > 0) {
      console.log(JSON.stringify(winnersResult.rows[0], null, 2));
    } else {
      console.log("❌ No winner record");
    }

    // Check if jerry exists anywhere in profiles
    const jerryResult = await client.query(`
      SELECT wallet_address, username, display_name
      FROM profiles
      WHERE username = 'jerry' OR display_name = 'jerry'
    `);

    console.log('\nSEARCH FOR "jerry":');
    if (jerryResult.rows.length > 0) {
      console.log(JSON.stringify(jerryResult.rows, null, 2));
    } else {
      console.log('❌ No profile with username/display_name "jerry"');
    }
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

checkProfile();
