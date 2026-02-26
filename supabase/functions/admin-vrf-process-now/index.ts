import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 200, headers: corsHeaders });

  // MINIMAL DEBUG - just return success to verify deployment is working
  return new Response(
    JSON.stringify({ ok: true, debug: "v3 - minimal test" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
