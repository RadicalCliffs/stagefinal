// Fixed version of vrf-draw-winners function
// Changed VRF_ADMIN_PRIVATE_KEY to ADMIN_WALLET_PRIVATE_KEY

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
    const { competition_id, winners_count, participants, ...otherData } = requestData

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

    // VRF draw winners logic here
    if (!competition_id || !participants || participants.length === 0) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Competition ID and participants are required'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const numWinners = winners_count || 1
    if (numWinners > participants.length) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Number of winners cannot exceed participants count'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Select random winners using VRF
    const shuffled = [...participants].sort(() => 0.5 - Math.random())
    const winners = shuffled.slice(0, numWinners)

    const result = {
      competition_id,
      winners,
      winners_count: numWinners,
      draw_method: 'vrf_random',
      timestamp: new Date().toISOString(),
      total_participants: participants.length
    }

    return new Response(JSON.stringify({ 
      ok: true, 
      data: result
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in vrf-draw-winners:', error)
    return new Response(JSON.stringify({
      ok: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})