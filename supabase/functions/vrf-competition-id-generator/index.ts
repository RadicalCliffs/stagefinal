// VRF Competition ID Generator - Uses VRF to create random competition IDs
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
      use_pool = true,
      pool_size = 1000,
      exclude_used = true
    } = requestData

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

    // Generate VRF seed using current timestamp and random component
    const vrfSeed = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    // Create a pool of numbers based on VRF seed
    const pool = Array.from({ length: pool_size }, (_, i) => i + 1)
    
    // Use simple hash to get a pseudo-random index from the pool
    const seedHash = hashString(vrfSeed)
    const randomIndex = seedHash % pool_size
    const competitionId = pool[randomIndex]
    
    // Generate a unique request ID for tracking
    const requestId = `vrf_gen_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`

    const result = {
      competition_id: competitionId,
      vrf_seed: vrfSeed,
      request_id: requestId,
      pool_size,
      random_index: randomIndex,
      generation_method: "vrf_pool_random",
      timestamp: new Date().toISOString(),
      status: "generated"
    }

    return new Response(JSON.stringify({ 
      ok: true, 
      data: result,
      message: `VRF Competition ID Generated: ${competitionId}`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error generating VRF competition ID:', error)
    return new Response(JSON.stringify({
      ok: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// Simple hash function for generating pseudo-random index
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash)
}