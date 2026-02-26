import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CompetitionRow = {
  id: string;
  title: string | null;
  status: string | null;
  total_tickets: number | null;
  is_instant_win: boolean | null;
  winner_address: string | null;
  uid: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRole)
      throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceRole);
    const body = await req.json().catch(() => ({}));
    const competitionId: string | undefined = body?.competitionId;

    // Query sold_out competitions
    const { data, error } = await supabase
      .from("competitions")
      .select("id,title,status,total_tickets,is_instant_win,winner_address,uid")
      .is("winner_address", null)
      .eq("status", "sold_out")
      .limit(20);

    if (error) throw error;

    return new Response(
      JSON.stringify({
        ok: true,
        found: (data || []).length,
        competitions: data || [],
        message: "Query test successful - viem not loaded yet",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
