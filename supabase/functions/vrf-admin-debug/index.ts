// VRF Admin Debug - Based on user's source of truth
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createPublicClient, createWalletClient, http, parseAbi } from 'https://esm.sh/viem'
import { privateKeyToAccount } from 'https://esm.sh/viem/accounts'
import { base } from 'https://esm.sh/viem/chains'

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
    const { competitionId } = requestData

    if (!competitionId) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'competitionId required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const adminWalletKey = Deno.env.get('ADMIN_WALLET_PRIVATE_KEY')
    const baseRpc = Deno.env.get('BASE_RPC') || 'https://base-rpc.publicnode.com'
    const contractAddress = Deno.env.get('CONTRACT_ADDRESS') || '0x8ce54644e3313934d663c43aea29641dfd8bca1a'
    
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
      "function competitions(uint256) view returns (uint256,uint256,uint256,uint256,bool,bool,uint8,uint32,uint256)",
      "function getWinners(uint256) view returns (uint256[] winningNumbers,address[] winners)",
      "function drawWinners(uint256 competitionId,bool useVRF) external returns (uint256 requestId)"
    ])

    console.log(`🔍 Debugging Competition ${competitionId}`)
    console.log('Contract:', contractAddress)
    console.log('RPC:', baseRpc)
    
    // Get competition details
    const c = await pub.readContract({
      address: contractAddress,
      abi,
      functionName: "competitions",
      args: [BigInt(competitionId)]
    })
    
    const totalTickets = c[0]
    const ticketsSold = c[1]
    const pricePerTicket = c[2]
    const endTime = c[3]
    const active = c[4]
    const drawn = c[5]
    const numWinners = c[6]
    const maxTicketsPerTx = c[7]
    const totalCollected = c[8]
    
    const now = Math.floor(Date.now() / 1000)
    const isEnded = now >= Number(endTime)
    
    // Check current winners
    let winners = []
    let winningNumbers = []
    try {
      const [nums, addrs] = await pub.readContract({
        address: contractAddress,
        abi,
        functionName: "getWinners",
        args: [BigInt(competitionId)]
      })
      winners = addrs
      winningNumbers = nums
    } catch (e) {
      console.log('No winners found:', e.message)
    }
    
    const debugInfo = {
      competitionId: competitionId.toString(),
      details: {
        totalTickets: totalTickets.toString(),
        ticketsSold: ticketsSold.toString(),
        pricePerTicket: pricePerTicket.toString(),
        pricePerTicketEth: Number(pricePerTicket) / 1e18,
        endTime: Number(endTime),
        endTimeFormatted: new Date(Number(endTime) * 1000).toISOString(),
        isEnded,
        active,
        drawn,
        numWinners: numWinners.toString(),
        maxTicketsPerTx: maxTicketsPerTx.toString(),
        totalCollected: totalCollected.toString(),
        totalCollectedEth: Number(totalCollected) / 1e18,
        timeRemaining: isEnded ? 0 : Number(endTime) - now
      },
      status: {
        canDraw: ticketsSold > 0n && isEnded && active && !drawn,
        isReady: ticketsSold > 0n && isEnded && !drawn,
        hasEnded: isEnded,
        hasTickets: ticketsSold > 0n,
        isActive: active,
        isDrawn: drawn,
        winnersCount: winners.length
      },
      winners: {
        addresses: winners.map(w => w.toString()),
        winningNumbers: winningNumbers.map(n => n.toString())
      }
    }
    
    // Test draw attempts if competition is ready
    let testResults = {}
    
    if (debugInfo.status.canDraw) {
      console.log('🧪 Testing VRF draw...')
      
      try {
        // Test VRF draw
        const vrfHash = await wallet.writeContract({
          address: contractAddress,
          abi,
          functionName: "drawWinners",
          args: [BigInt(competitionId), true] // true = use VRF
        })
        
        console.log('VRF TX:', vrfHash)
        const vrfReceipt = await pub.waitForTransactionReceipt({ hash: vrfHash })
        
        // Check for DrawRequested event
        const drawRequested = vrfReceipt.logs
          .map((log) => {
            try {
              return pub.decodeEventLog({ abi, ...log })
            } catch {
              return null
            }
          })
          .find((x) => x && x.eventName === 'DrawRequested')
        
        testResults.vrf = {
          success: true,
          txHash: vrfHash,
          blockNumber: vrfReceipt.blockNumber.toString(),
          gasUsed: vrfReceipt.gasUsed.toString(),
          requestId: drawRequested ? drawRequested.args.requestId.toString() : 'not_found'
        }
        
        console.log('✅ VRF test successful')
        
      } catch (e) {
        console.log('❌ VRF test failed:', e.shortMessage || e.message)
        testResults.vrf = {
          success: false,
          error: e.shortMessage || e.message
        }
      }
      
      // Test pseudo-random fallback
      try {
        console.log('🧪 Testing pseudo-random fallback...')
        const pseudoHash = await wallet.writeContract({
          address: contractAddress,
          abi,
          functionName: "drawWinners",
          args: [BigInt(competitionId), false] // false = pseudo-random
        })
        
        console.log('Pseudo TX:', pseudoHash)
        const pseudoReceipt = await pub.waitForTransactionReceipt({ hash: pseudoHash })
        
        testResults.pseudoRandom = {
          success: true,
          txHash: pseudoHash,
          blockNumber: pseudoReceipt.blockNumber.toString(),
          gasUsed: pseudoReceipt.gasUsed.toString()
        }
        
        console.log('✅ Pseudo-random test successful')
        
      } catch (e) {
        console.log('❌ Pseudo-random test failed:', e.shortMessage || e.message)
        testResults.pseudoRandom = {
          success: false,
          error: e.shortMessage || e.message
        }
      }
    } else {
      testResults.message = 'Competition not ready for drawing'
    }
    
    const response = {
      ok: true,
      debugInfo,
      testResults,
      recommendations: generateRecommendations(debugInfo),
      timestamp: new Date().toISOString()
    }
    
    console.log('✅ Debug complete for competition', competitionId)
    
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('Error in VRF debug:', error)
    return new Response(JSON.stringify({
      ok: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

function generateRecommendations(debugInfo) {
  const recs = []
  
  if (!debugInfo.status.hasTickets) {
    recs.push('No tickets sold - cannot draw winners')
  }
  
  if (!debugInfo.status.hasEnded) {
    recs.push('Competition has not ended yet')
  }
  
  if (!debugInfo.status.isActive) {
    recs.push('Competition is not active')
  }
  
  if (debugInfo.status.isDrawn) {
    recs.push('Competition already drawn')
  }
  
  if (debugInfo.status.canDraw) {
    recs.push('Ready to draw winners - use batch_vrf_process or call drawWinners manually')
  }
  
  if (debugInfo.details.timeRemaining < 0) {
    recs.push('Competition is overdue for drawing')
  }
  
  return recs
}