// Test the RPC function directly with different parameter formats
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://mthwfldcjvpxjtmrqkqm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
);

const compId = "a879ba68-d098-42f6-a687-f70fd7109ee8"; // Win 25 SOL

console.log(
  "Testing get_unavailable_tickets RPC with different parameter formats\n",
);

// Test 1: With p_competition_id (TEXT)
console.log("1️⃣  Test with p_competition_id (string):");
try {
  const { data, error } = await supabase.rpc("get_unavailable_tickets", {
    p_competition_id: compId,
  });
  if (error) {
    console.error("   ❌ Error:", error.message);
  } else {
    console.log(`   ✅ Success: ${data?.length || 0} unavailable tickets`);
  }
} catch (e) {
  console.error("   ❌ Exception:", e.message);
}

// Test 2: With competition_id (what frontend uses)
console.log("\n2️⃣  Test with competition_id (what frontend uses):");
try {
  const { data, error } = await supabase.rpc("get_unavailable_tickets", {
    competition_id: compId,
  });
  if (error) {
    console.error("   ❌ Error:", error.message);
  } else {
    console.log(`   ✅ Success: ${data?.length || 0} unavailable tickets`);
  }
} catch (e) {
  console.error("   ❌ Exception:", e.message);
}

// Test 3: With p_competition_id cast as UUID
console.log("\n3️⃣  Test with explicit cast:");
try {
  const response = await fetch(
    "https://mthwfldcjvpxjtmrqkqm.supabase.co/rest/v1/rpc/get_unavailable_tickets",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey:
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
        Authorization:
          "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aHdmbGRjanZweGp0bXJxa3FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MjkxNjQsImV4cCI6MjA4MTMwNTE2NH0.0yANezx06a-NgPSdNjeuUG3nEng5y1BbWX9Bf6Oxlrg",
      },
      body: JSON.stringify({ p_competition_id: compId }),
    },
  );

  if (response.ok) {
    const data = await response.json();
    console.log(`   ✅ Success: ${data?.length || 0} unavailable tickets`);
    if (data && data.length > 0) {
      console.log(`   First 10: ${data.slice(0, 10).join(", ")}`);
    }
  } else {
    const errorText = await response.text();
    console.error("   ❌ HTTP Error:", response.status, errorText);
  }
} catch (e) {
  console.error("   ❌ Exception:", e.message);
}

console.log("\n💡  Solution: Remove UUID overload and keep only TEXT version");
