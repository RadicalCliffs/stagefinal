// VRF Admin Batch Process - Based on user's source of truth
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createPublicClient, createWalletClient, http, parseAbi } from 'https://esm.sh/viem'
import { privateKeyToAccount } from 'https://esm.sh/viem/accounts'
import { base } from 'https://esm.sh/viem/chains'

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
    const adminWalletKey = Deno.env.get('ADMIN_WALLET_PRIVATE_KEY')
    const baseRpc = Deno.env.get('BASE_RPC') || 'https://base-rpc.publicnode.com'
    const contractAddress = Deno.env.get('CONTRACT_ADDRESS') || '0x8ce54644e3313934D663c43Aea29641DFD8BcA1A'
    
    if (!adminWalletKey) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'ADMIN_WALLET_PRIVATE_KEY not configured' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Setup viem clients using user's configuration
    const admin = privateKeyToAccount(adminWalletKey)
    
    const pub = createPublicClient({ 
      chain: base, 
      transport: http(baseRpc) 
    })
    
    const wallet = createWalletClient({ 
      chain: base, 
      transport: http(baseRpc), 
      account: admin 
    })

    // User's correct ABI from source of truth
    const abi = parseAbi([
      "function nextCompetitionId() view returns (uint256)",
      "function competitions(uint256) view returns (uint256,uint256,uint256,uint256,bool,bool,uint8,uint32,uint256)",
      "function drawWinners(uint256 competitionId,bool useVRF) external returns (uint256 requestId)",
      "function getWinners(uint256) view returns (uint256[] winningNumbers,address[] winners)"
    ])

    console.log('🔄 Starting Batch VRF Processing...')
    console.log('Contract:', contractAddress)
    console.log('RPC:', baseRpc)
    
    const nextId = await pub.readContract({
      address: contractAddress,
      abi,
      functionName: "nextCompetitionId",
    })
    
    const totalCompetitions = BigInt(nextId)
    const eligibleCompetitions = []
    
    console.log(`📊 Checking ${totalCompetitions.toString()} competitions...`)
    
    // Find eligible competitions (same logic as batch_vrf_process.mjs)
    for (let i = 0n; i < totalCompetitions; i++) {
      try {
        const c = await pub.readContract({
          address: contractAddress,
          abi,
          functionName: "competitions",
          args: [i]
        })
        
        const ticketsSold = c[1]
        const endTime = c[3]
        const active = c[4]
        const drawn = c[5]
        const now = BigInt(Math.floor(Date.now() / 1000))
        
        // Eligible if: has tickets, ended, active, not drawn
        if (ticketsSold > 0n && endTime <= now && active && !drawn) {
          eligibleCompetitions.push({
            id: i,
            ticketsSold: ticketsSold.toString(),
            endTime: Number(endTime),
            numWinners: c[6].toString()
          })
        }
      } catch (e) {
        // Competition might not exist, skip
      }
    }
    
    console.log(`✅ Found ${eligibleCompetitions.length} eligible competitions:`)
    eligibleCompetitions.forEach(comp => {
      console.log(`- Competition ${comp.id}: ${comp.ticketsSold} tickets, ${comp.numWinners} winners`)
    })
    
    if (eligibleCompetitions.length === 0) {
      return new Response(JSON.stringify({ 
        ok: true, 
        message: 'No eligible competitions found',
        processed: 0,
        eligibleCompetitions: []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    const results = []
    
    // Process each competition using user's VRF logic
    for (const comp of eligibleCompetitions) {
      console.log(`\n🎯 Processing Competition ${comp.id}...`)
      
      try {
        // Try VRF draw first (same as batch_vrf_process.mjs)
        const hash = await wallet.writeContract({
          address: contractAddress,
          abi,
          functionName: "drawWinners",
          args: [comp.id, true] // true = use VRF
        })
        
        console.log(`✅ VRF Draw TX: ${hash}`)
        const receipt = await pub.waitForTransactionReceipt({ hash })
        
        // Wait a bit between transactions
        await new Promise(r => setTimeout(r, 2000))
        
        // Verify success
        try {
          const [nums, addrs] = await pub.readContract({
            address: contractAddress,
            abi,
            functionName: "getWinners",
            args: [comp.id]
          })
          console.log(`✅ Competition ${comp.id} completed! Winners: ${addrs.length}`)
          
          results.push({
            competitionId: comp.id.toString(),
            status: 'completed',
            winners: addrs.length,
            txHash: hash,
            winningNumbers: nums.map(n => n.toString())
          })
          
        } catch (e) {
          console.log(`⚠️ Competition ${comp.id} VRF pending (Chainlink processing)`)
          results.push({
            competitionId: comp.id.toString(),
            status: 'vrf_pending',
            txHash: hash,
            message: 'VRF fulfillment pending'
          })
        }
        
      } catch (e) {
        console.log(`❌ Competition ${comp.id} failed: ${e.shortMessage || e.message}`)
        
        // Try fallback to pseudo-random (same as batch_vrf_process.mjs)
        try {
          console.log(`🔄 Trying pseudo-random fallback for competition ${comp.id}...`)
          const hash = await wallet.writeContract({
            address: contractAddress,
            abi,
            functionName: "drawWinners",
            args: [comp.id, false] // false = pseudo-random fallback
          })
          
          console.log(`✅ Pseudo-random draw TX: ${hash}`)
          await pub.waitForTransactionReceipt({ hash })
          console.log(`✅ Competition ${comp.id} completed with pseudo-random!`)
          
          results.push({
            competitionId: comp.id.toString(),
            status: 'fallback_completed',
            txHash: hash,
            method: 'pseudo_random'
          })
          
        } catch (fallbackError) {
          console.log(`❌ Competition ${comp.id} fallback also failed: ${fallbackError.shortMessage || fallbackError.message}`)
          results.push({
            competitionId: comp.id.toString(),
            status: 'failed',
            error: e.shortMessage || e.message
          })
        }
      }
    }
    
    console.log('\n🎉 Batch processing completed!')
    
    const summary = {
      totalCompetitions: totalCompetitions.toString(),
      eligibleCompetitions: eligibleCompetitions.length,
      processed: results.length,
      completed: results.filter(r => r.status === 'completed').length,
      vrfPending: results.filter(r => r.status === 'vrf_pending').length,
      fallbackUsed: results.filter(r => r.status === 'fallback_completed').length,
      failed: results.filter(r => r.status === 'failed').length,
      results: results
    }
    
    return new Response(JSON.stringify({ 
      ok: true, 
      message: 'Batch VRF processing completed',
      summary
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('Error in batch VRF processing:', error)
    return new Response(JSON.stringify({
      ok: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})