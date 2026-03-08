import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

async function checkAllDates() {
  console.log("🔍 Checking for fake hashes across ALL dates...\n");

  // Check tickets by date from Feb onwards
  const dates = [
    "2026-02-20",
    "2026-02-21",
    "2026-02-22",
    "2026-02-23",
    "2026-02-24",
    "2026-02-25",
    "2026-02-26",
    "2026-02-27",
    "2026-02-28",
    "2026-03-01",
    "2026-03-02",
    "2026-03-03",
    "2026-03-04",
    "2026-03-05",
    "2026-03-06",
    "2026-03-07",
    "2026-03-08",
  ];

  const knownRealHashes = [
    "0x7542cd73", // User 1's real hash
    "0x271a504c", // User 2's real hash
    "0xaadebf88", // Recent real hash we found
  ];

  for (const date of dates) {
    const { data: tickets } = await supabase
      .from("tickets")
      .select("ticket_number, tx_id, created_at")
      .gte("created_at", `${date}T00:00:00`)
      .lte("created_at", `${date}T23:59:59`)
      .limit(1000);

    if (!tickets || tickets.length === 0) continue;

    // Filter for suspicious 0x hashes (excluding known real ones)
    const suspiciousHashes = tickets.filter((t) => {
      if (!t.tx_id || !t.tx_id.startsWith("0x") || t.tx_id.length !== 66)
        return false;
      // Exclude known real hashes
      return !knownRealHashes.some((real) => t.tx_id.startsWith(real));
    });

    if (suspiciousHashes.length > 0) {
      console.log(
        `📅 ${date}: ${tickets.length} tickets, ${suspiciousHashes.length} with potential fake hashes`,
      );

      // Get unique hashes for this date
      const uniqueHashes = [...new Set(suspiciousHashes.map((t) => t.tx_id))];
      console.log(`   ${uniqueHashes.length} unique hash(es)`);
      uniqueHashes.slice(0, 3).forEach((hash) => {
        const count = suspiciousHashes.filter((t) => t.tx_id === hash).length;
        console.log(`   - ${hash.substring(0, 20)}... (${count} tickets)`);
      });
      console.log("");
    }
  }

  console.log("\n✅ Done scanning dates");
}

checkAllDates().catch(console.error);
