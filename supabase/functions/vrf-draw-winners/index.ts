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

    // SECURITY: Use VRF contract for provably fair winner selection
    // Forward to vrf-draw-winner which uses pregenerated VRF seed
    // NOTE: This function is currently not in use. For multi-winner competitions,
    // consider implementing a batch winner selection to avoid duplicate winners.
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Supabase configuration missing'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // WARNING: Calling vrf-draw-winner multiple times may select duplicate winners
    // because each call uses the same VRF seed. For production use, implement
    // batch winner selection or track excluded tickets between calls.
    const winners = []
    for (let i = 0; i < numWinners; i++) {
      const vrfResponse = await fetch(
        `${supabaseUrl}/functions/v1/vrf-draw-winner`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`
          },
          body: JSON.stringify({ competition_id })
        }
      )
      
      if (!vrfResponse.ok) {
        const errorText = await vrfResponse.text()
        throw new Error(`VRF HTTP ${vrfResponse.status}: ${errorText}`)
      }
      
      const vrfResult = await vrfResponse.json()
      if (!vrfResult.ok) {
        throw new Error(vrfResult.error || 'VRF draw failed')
      }
      
      winners.push({
        address: vrfResult.winner_address,
        user_id: vrfResult.winner_user_id,
        ticket_number: vrfResult.winning_ticket_number
      })
    }

    const result = {
      competition_id,
      winners,
      winners_count: numWinners,
      draw_method: 'vrf_contract',
      vrf_contract: '0xc5DfC3f6A227b30161F53f0bC167495158854854',
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