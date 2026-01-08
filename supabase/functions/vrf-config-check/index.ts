// VRF Configuration Checker
// Verifies environment variables and contract setup

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'false'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const RPC = Deno.env.get('BASE_RPC');
    const CONTRACT = Deno.env.get('VRF_CONSUMER_ADDRESS');
    const ADMIN_PK = Deno.env.get('ADMIN_WALLET_PRIVATE_KEY');

    const config = {
      timestamp: new Date().toISOString(),
      environment: {
        BASE_RPC: RPC ? '✅ Set' : '❌ Missing',
        VRF_CONSUMER_ADDRESS: CONTRACT ? '✅ Set' : '❌ Missing',
        ADMIN_WALLET_PRIVATE_KEY: ADMIN_PK ? '✅ Set (private key loaded)' : '❌ Missing'
      },
      values: {
        RPC: RPC || 'Not set',
        VRF_CONSUMER_ADDRESS: CONTRACT || 'Not set',
        ADMIN_WALLET_PRIVATE_KEY: ADMIN_PK ? `${ADMIN_PK.substring(0, 10)}...${ADMIN_PK.substring(-8)}` : 'Not set'
      }
    };

    // Check if all required variables are present
    const allSet = RPC && CONTRACT && ADMIN_PK;
    
    config.status = allSet ? 'ready' : 'missing_variables';
    config.message = allSet 
      ? 'All environment variables are configured' 
      : 'Some environment variables are missing';

    return new Response(
      JSON.stringify(config, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});