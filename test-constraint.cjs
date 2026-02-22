const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();
const s = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
);

(async () => {
  // Use real user jerry to test
  const realUser = "prize:pid:0x0ff51ec0ecc9ae1e5e6048976ba307c849781363";
  const realComp = "e2e04124-5ea9-4fb2-951a-26e6d0991615";

  // This user already has an entry - try inserting duplicate
  const { error } = await s.from("joincompetition").insert({
    user_id: realUser,
    competition_id: realComp,
    canonical_user_id: realUser,
    ticket_numbers: "99999",
    purchase_date: new Date().toISOString(),
    status: "test",
  });

  console.log("Insert duplicate result:");
  console.log(error?.message || "UNEXPECTEDLY SUCCEEDED");
  console.log("");
  console.log(
    "Does error contain uq_jc_user_competition?",
    error?.message?.includes("uq_jc_user_competition"),
  );
  process.exit(0);
})();
