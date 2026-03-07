import { keccak256, toHex } from "viem";
import crypto from "crypto";

// Test data from the 25 SOL competition
const vrfSeed =
  "9259da22ee10994a4d80a9fb116171bcac20baa817ad0a47a685a46d4b9c0e21";
const competitionId = "1ee56f06-0c04-4f6e-9dfd-9d2c5f24e6c1"; // Need to find this
const ticketsSold = 638;
const actualWinningTicket = 1922;

console.log("\n=== VRF CALCULATION TEST ===\n");
console.log("VRF Seed:", vrfSeed);
console.log("Tickets Sold:", ticketsSold);
console.log("Actual Winning Ticket:", actualWinningTicket);
console.log("\n--- TESTING DIFFERENT METHODS ---\n");

// Method 1: What I implemented (keccak256 of full string)
try {
  const message = `SELECT-WINNER-${vrfSeed}-${competitionId}`;
  const hash = keccak256(toHex(message));
  const hashBigInt = BigInt(hash);
  const result = Number(hashBigInt % BigInt(ticketsSold)) + 1;
  console.log("Method 1 (keccak256 full string):");
  console.log("  Message:", message);
  console.log("  Hash:", hash);
  console.log("  Result:", result);
  console.log("  Match:", result === actualWinningTicket ? "✓" : "✗");
} catch (err) {
  console.log("Method 1 ERROR:", err.message);
}

// Method 2: PostgreSQL digest method (sha256, first 16 hex chars)
try {
  const message = `SELECT-WINNER-${vrfSeed}-${competitionId}`;
  const hash = crypto.createHash("sha256").update(message).digest("hex");
  const first16 = hash.substring(0, 16);
  const hashBigInt = BigInt("0x" + first16);
  const result = Number(hashBigInt % BigInt(ticketsSold)) + 1;
  console.log("\nMethod 2 (sha256, first 16 hex chars - PostgreSQL method):");
  console.log("  Message:", message);
  console.log("  Hash:", hash);
  console.log("  First 16:", first16);
  console.log("  Result:", result);
  console.log("  Match:", result === actualWinningTicket ? "✓" : "✗");
} catch (err) {
  console.log("Method 2 ERROR:", err.message);
}

// Method 3: Simple modulo of seed
try {
  const seedBigInt = BigInt("0x" + vrfSeed);
  const result = Number(seedBigInt % BigInt(ticketsSold)) + 1;
  console.log("\nMethod 3 (simple seed modulo):");
  console.log("  Result:", result);
  console.log("  Match:", result === actualWinningTicket ? "✓" : "✗");
} catch (err) {
  console.log("Method 3 ERROR:", err.message);
}

console.log("\n");
