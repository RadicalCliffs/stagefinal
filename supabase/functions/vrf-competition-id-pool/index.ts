// VRF Competition ID Pool Generator - Creates and manages pool of competition IDs
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
    const { 
      action = "generate_pool",
      pool_size = 1000,
      batch_id
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

    if (action === "generate_pool") {
      // Generate a batch of VRF-based competition IDs
      const pool = generateVRFPool(pool_size, batch_id)
      
      const result = {
        action: "generate_pool",
        pool_size: pool.length,
        batch_id: pool[0].batch_id,
        ids: pool.map(p => p.competition_id),
        timestamp: new Date().toISOString(),
        generation_method: "vrf_pool_random",
        status: "pool_generated"
      }

      return new Response(JSON.stringify({ 
        ok: true, 
        data: result,
        message: `Generated VRF Competition ID Pool: ${pool.length} IDs`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === "get_next") {
      // Get next available competition ID from pool
      const nextId = getNextFromPool()
      
      return new Response(JSON.stringify({ 
        ok: true, 
        data: {
          action: "get_next",
          competition_id: nextId,
          timestamp: new Date().toISOString()
        },
        message: `Next VRF Competition ID: ${nextId}`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ 
      ok: false, 
      error: 'Invalid action. Use "generate_pool" or "get_next"' 
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in VRF competition ID pool:', error)
    return new Response(JSON.stringify({
      ok: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// Generate a pool of VRF-based competition IDs
function generateVRFPool(size: number, batchId?: string): Array<{competition_id: number, batch_id: string, vrf_seed: string}> {
  const batch = batchId || `batch_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
  const pool = []
  
  for (let i = 0; i < size; i++) {
    const vrfSeed = `${batch}_${i}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const competitionId = generateVRFCompetitionId(vrfSeed)
    
    pool.push({
      competition_id: competitionId,
      batch_id: batch,
      vrf_seed: vrfSeed
    })
  }
  
  return pool
}

// Generate a single VRF-based competition ID
function generateVRFCompetitionId(seed?: string): number {
  const pool = Array.from({ length: 100000 }, (_, i) => i + 1)
  const finalSeed = seed || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const hash = simpleHash(finalSeed)
  const index = hash % pool.length
  return pool[index]
}

// Simple hash function
function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash)
}

// Simple pool management (in-memory for demo)
let currentPoolIndex = 0
let currentPool: number[] = []

function getNextFromPool(): number {
  if (currentPoolIndex >= currentPool.length) {
    // Generate new pool when current one is exhausted
    const newPool = generateVRFPool(1000)
    currentPool = newPool.map(p => p.competition_id)
    currentPoolIndex = 0
  }
  
  const nextId = currentPool[currentPoolIndex]
  currentPoolIndex++
  return nextId
}