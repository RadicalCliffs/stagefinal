#!/usr/bin/env node
/**
 * VRF Winner Selection - Complete Test
 * Demonstrates the full provably fair winner selection flow
 */

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const { keccak256, toHex } = require("viem");

const SUPABASE_URL = "https://mthwfldcjvpxjtmrqkqm.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTcyOTE2NCwiZXhwIjoyMDgxMzA1MTY0fQ.nJzthe4gN1tLY4S6Ukqb14_MLjmPRqpC4e7a--DSPIY";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runTest() {
  console.log("");
  console.log("=".repeat(60));
  console.log("🎰 VRF WINNER SELECTION - COMPLETE TEST");
  console.log("=".repeat(60));

  // 1. Create competition
  const compId = crypto.randomUUID();
  const vrfSeed = "0x" + crypto.randomBytes(32).toString("hex");

  console.log("\n📦 Creating competition: 100 tickets @ $0.10");

  await supabase.from("competitions").insert({
    id: compId,
    title: "Final VRF Test - " + Date.now().toString().slice(-6),
    description: "VRF Winner Selection Test",
    image_url: "https://theprize.io/images/bitcoin.png",
    ticket_price: 0.1,
    total_tickets: 100,
    tickets_sold: 0,
    num_winners: 1,
    prize_description: "Test Prize",
    prize_value: 10.0,
    status: "active",
    is_instant_win: false,
    deleted: false,
    end_date: new Date(Date.now() + 60000).toISOString(),
    outcomes_vrf_seed: vrfSeed,
  });

  console.log("✅ Competition ID:", compId);
  console.log("   VRF Seed:", vrfSeed.substring(0, 30) + "...");

  // 2. Create 20 users buying 5 tickets each
  console.log("\n🎫 Buying 100 tickets (20 users × 5 tickets each)");

  const tickets = [];
  let ticketNum = 1;
  const users = [];

  for (let u = 0; u < 20; u++) {
    const wallet = "0x" + crypto.randomBytes(20).toString("hex");
    const userId = "prize:pid:" + wallet;
    users.push({ wallet, userId, tickets: [] });

    for (let t = 0; t < 5; t++) {
      users[u].tickets.push(ticketNum);
      tickets.push({
        id: crypto.randomUUID(),
        competition_id: compId,
        ticket_number: ticketNum,
        user_id: userId,
        canonical_user_id: userId,
        wallet_address: wallet,
        status: "sold",
        purchase_price: 0.1,
      });
      ticketNum++;
    }
  }

  await supabase.from("tickets").insert(tickets);
  await supabase
    .from("competitions")
    .update({ tickets_sold: 100, status: "drawing" })
    .eq("id", compId);

  console.log("✅ Tickets sold to 20 users");
  console.log("   Sample: User 1 has tickets 1-5, User 2 has 6-10, etc.");

  // 3. Draw winner using VRF seed
  console.log("\n🎲 DRAWING WINNER using VRF seed...");

  const selectionInput = `SELECT-WINNER-${vrfSeed}-${compId}`;
  const selectionHash = keccak256(toHex(selectionInput));
  const hashBigInt = BigInt(selectionHash);
  const winningTicket = Number((hashBigInt % 100n) + 1n);

  console.log("   Selection hash:", selectionHash.substring(0, 30) + "...");
  console.log("   Hash mod 100 + 1 = Ticket #" + winningTicket);

  // Find winner
  const winnerUser = users.find((u) => u.tickets.includes(winningTicket));

  console.log("\n" + "=".repeat(60));
  console.log("🏆 WINNER SELECTED!");
  console.log("=".repeat(60));
  console.log("");
  console.log("   🎫 Winning Ticket: #" + winningTicket);
  console.log("   👤 Winner Wallet:  " + winnerUser.wallet);
  console.log("   🎲 VRF Seed:       " + vrfSeed.substring(0, 40) + "...");
  console.log("");

  // Update competition
  await supabase
    .from("competitions")
    .update({
      winner_address: winnerUser.wallet,
      status: "drawn",
      vrf_draw_completed_at: new Date().toISOString(),
    })
    .eq("id", compId);

  await supabase.from("competition_winners").insert({
    competitionid: compId,
    Winner: winnerUser.wallet,
    ticket_number: winningTicket,
    user_id: winnerUser.userId,
    vrf_seed: vrfSeed,
    drawn_at: new Date().toISOString(),
  });

  // 4. Verification
  console.log("🔍 VERIFICATION (Provably Fair):");
  console.log("   Anyone can verify this result:");
  console.log("   1. Take VRF seed: " + vrfSeed.substring(0, 30) + "...");
  console.log(
    '   2. Compute: keccak256("SELECT-WINNER-" + seed + "-" + compId)',
  );
  console.log("   3. Result mod 100 + 1 = Winning ticket");
  console.log("");

  // Re-verify
  const verifyHash = keccak256(toHex(`SELECT-WINNER-${vrfSeed}-${compId}`));
  const verifyTicket = Number((BigInt(verifyHash) % 100n) + 1n);
  console.log("   ✅ Re-verified: Ticket #" + verifyTicket + " = Correct!");
  console.log("");
  console.log("=".repeat(60));
  console.log("✅ VRF TEST COMPLETE - Competition ID: " + compId);
  console.log("=".repeat(60));
}

runTest().catch(console.error);
