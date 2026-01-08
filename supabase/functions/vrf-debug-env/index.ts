// Fixed version of vrf-debug-env function
// Changed VRF_ADMIN_PRIVATE_KEY to ADMIN_WALLET_PRIVATE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'false'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders })
  }

  try {
    const requestData = await req.json()
    const { check_keys, ...otherData } = requestData

    // Fixed: Use ADMIN_WALLET_PRIVATE_KEY instead of VRF_ADMIN_PRIVATE_KEY
    const adminWalletPrivateKey = Deno.env.get('ADMIN_WALLET_PRIVATE_KEY')
    const vrfAdminPrivateKey = Deno.env.get('VRF_ADMIN_PRIVATE_KEY')
    
    // Check environment variables
    const envCheck = {
      ADMIN_WALLET_PRIVATE_KEY: adminWalletPrivateKey ? 'configured' : 'missing',
      VRF_ADMIN_PRIVATE_KEY: vrfAdminPrivateKey ? 'configured' : 'missing',
      SUPABASE_URL: Deno.env.get('SUPABASE_URL') ? 'configured' : 'missing',
      SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY') ? 'configured' : 'missing',
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ? 'configured' : 'missing'
    }

    const issues = []
    if (!adminWalletPrivateKey) {
      issues.push('ADMIN_WALLET_PRIVATE_KEY is missing - this should be used instead of VRF_ADMIN_PRIVATE_KEY')
    }
    if (vrfAdminPrivateKey) {
      issues.push('VRF_ADMIN_PRIVATE_KEY is deprecated - use ADMIN_WALLET_PRIVATE_KEY instead')
    }

    const debugInfo = {
      environment_variables: envCheck,
      issues: issues,
      recommendations: [
        'Ensure ADMIN_WALLET_PRIVATE_KEY is properly configured',
        'Replace any references to VRF_ADMIN_PRIVATE_KEY with ADMIN_WALLET_PRIVATE_KEY',
        'Verify wallet has sufficient balance for gas fees'
      ],
      timestamp: new Date().toISOString(),
      function_version: 'vrf-debug-env-fixed-v1.0'
    }

    return new Response(JSON.stringify({ 
      ok: true, 
      data: debugInfo
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in vrf-debug-env:', error)
    return new Response(JSON.stringify({
      ok: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})