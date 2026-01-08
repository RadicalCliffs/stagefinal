import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function res(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });

  try {
    console.log('🚀 Admin VRF Dashboard - Simple Test');

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    console.log('✅ Environment variables loaded');

    const requestData = await req.json();
    const { action } = requestData;

    console.log('📋 Action requested:', action);

    switch (action) {
      case 'list_expired':
        console.log('📋 Listing expired competitions...');
        
        // Simple database query without complex auth
        const { createClient } = await import("npm:@supabase/supabase-js@2");
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        const { data: competitions, error } = await supabase
          .from("competitions")
          .select("id, title, status, end_date, onchain_competition_id, vrf_requested_at, vrf_error")
          .lt("end_date", new Date().toISOString())
          .order("end_date", { ascending: false })
          .limit(10);

        if (error) {
          console.log('❌ Database error:', error.message);
          return res(500, { ok: false, error: error.message });
        }

        console.log('✅ Found competitions:', competitions?.length || 0);

        return res(200, {
          ok: true,
          message: "Expired competitions retrieved successfully!",
          expiredCompetitions: competitions || [],
          count: competitions?.length || 0,
          timestamp: new Date().toISOString()
        });

      case 'test':
        return res(200, {
          ok: true,
          message: "VRF Dashboard test successful!",
          timestamp: new Date().toISOString(),
          environment: {
            supabase_url: SUPABASE_URL ? '✅ Set' : '❌ Missing',
            service_role_key: SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ Missing'
          }
        });

      default:
        return res(400, {
          ok: false,
          error: 'Invalid action. Use: list_expired, test'
        });
    }

  } catch (e) {
    console.log('💥 Error:', e.message);
    console.log('💥 Stack:', e.stack);
    return res(500, { ok: false, error: (e as Error).message });
  }
});