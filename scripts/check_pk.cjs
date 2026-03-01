/**
 * Derive EOA address from private key
 *
 * Usage: node scripts/check_pk.cjs YOUR_PRIVATE_KEY
 */

const { privateKeyToAccount } = require("viem/accounts");

const pk = process.argv[2];

if (!pk) {
  console.log("Usage: node scripts/check_pk.cjs 0xYOUR_PRIVATE_KEY");
  process.exit(1);
}

// Ensure it starts with 0x
const normalizedPk = pk.startsWith("0x") ? pk : "0x" + pk;

try {
  const account = privateKeyToAccount(normalizedPk);
  console.log("Private key derives to EOA:", account.address);
  console.log("");
  console.log("If this matches one of your known EOAs, great!");
  console.log("If not, this key controls a different wallet.");
} catch (e) {
  console.error("Invalid private key:", e.message);
}
