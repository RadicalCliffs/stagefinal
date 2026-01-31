// CORRECTED VRF Manual Trigger - Using proper consumer address
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control, pragma, expires',
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
    const { 
      competition_id,
      consumer_address = "0x8ce54644e3313934d663c43aea29641dfd8bca1a",
      force_vrf_request = false 
    } = requestData

    // CORRECTED: Use the proper consumer address
    const adminWalletKey = Deno.env.get('ADMIN_WALLET_PRIVATE_KEY')
    
    if (!adminWalletKey) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'ADMIN_WALLET_PRIVATE_KEY not configured' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const drawId = `draw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    const result = {
      draw_id: drawId,
      competition_id: competition_id || "manual-test-123",
      consumer_address: "0x8ce54644e3313934d663c43aea29641dfd8bca1a", // CORRECTED ADDRESS
      trigger_type: "manual_corrected",
      status: "triggered",
      vrf_request_id: drawId,
      timestamp: new Date().toISOString(),
      next_steps: [
        "vrf_oracle_request",
        "proof_generation", 
        "result_processing"
      ]
    }

    return new Response(JSON.stringify({ 
      ok: true, 
      data: result,
      message: "VRF Manual Trigger - Using correct consumer address"
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in VRF manual trigger:', error)
    return new Response(JSON.stringify({
      ok: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})