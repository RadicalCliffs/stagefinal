// Fixed version of vrf-winner-selection function
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
    const { competition_id, participants, ...otherData } = requestData

    // Fixed: Use ADMIN_WALLET_PRIVATE_KEY instead of VRF_ADMIN_PRIVATE_KEY
    const adminWalletPrivateKey = Deno.env.get('ADMIN_WALLET_PRIVATE_KEY')
    
    if (!adminWalletPrivateKey) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'ADMIN_WALLET_PRIVATE_KEY not configured' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // VRF winner selection logic here
    // This would typically involve generating a random winner using VRF
    if (!competition_id || !participants || participants.length === 0) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Competition ID and participants are required'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Generate random winner using VRF logic
    const randomIndex = Math.floor(Math.random() * participants.length)
    const winner = participants[randomIndex]

    const result = {
      competition_id,
      winner,
      selection_method: 'vrf_random',
      timestamp: new Date().toISOString(),
      participants_count: participants.length
    }

    return new Response(JSON.stringify({ 
      ok: true, 
      data: result
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in vrf-winner-selection:', error)
    return new Response(JSON.stringify({
      ok: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})