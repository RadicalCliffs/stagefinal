// VRF Admin Monitor - Based on user's source of truth
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createPublicClient, http, parseAbi } from 'https://esm.sh/viem'
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
    const baseRpc = Deno.env.get('BASE_RPC') || 'https://base-rpc.publicnode.com'
    const contractAddress = Deno.env.get('CONTRACT_ADDRESS') || '0x8ce54644e3313934D663c43Aea29641DFD8BcA1A'

    // Setup public client using user's configuration
    const pub = createPublicClient({ 
      chain: base, 
      transport: http(baseRpc) 
    })

    // User's correct ABI from source of truth
    const abi = parseAbi([
      "function nextCompetitionId() view returns (uint256)",
      "function competitions(uint256) view returns (uint256,uint256,uint256,uint256,bool,bool,uint8,uint32,uint256)",
      "function getWinners(uint256) view returns (uint256[] winningNumbers,address[] winners)",
      "function owner() view returns (address)"
    ])

    console.log('📊 Competition Monitor Dashboard')
    console.log('='.repeat(50))
    
    const nextId = await pub.readContract({
      address: contractAddress,
      abi,
      functionName: "nextCompetitionId",
    })
    
    const totalCompetitions = BigInt(nextId)
    console.log(`📈 Total Competitions: ${totalCompetitions.toString()}`)
    
    // Get contract stats
    const contractBalance = await pub.getBalance({ address: contractAddress })
    console.log(`💰 Contract Balance: ${Number(contractBalance)/1e18} ETH`)
    
    const owner = await pub.readContract({
      address: contractAddress,
      abi,
      functionName: "owner",
    })
    console.log(`👑 Contract Owner: ${owner}`)
    console.log()
    
    // Categorize competitions (same logic as competition_monitor.mjs)
    const stats = {
      total: Number(totalCompetitions),
      active: 0,
      ended: 0,
      drawn: 0,
      withTickets: 0,
      instantWins: 0,
      regularWins: 0
    }
    
    const competitions = []
    
    console.log('🔍 Scanning all competitions...')
    
    // Scan all competitions
    for (let i = 0n; i < totalCompetitions; i++) {
      try {
        const c = await pub.readContract({
          address: contractAddress,
          abi,
          functionName: "competitions",
          args: [i]
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
        
        // Update stats
        if (active) stats.active++
        if (isEnded) stats.ended++
        if (drawn) stats.drawn++
        if (ticketsSold > 0n) stats.withTickets++
        
        // Try to get winners
        let winners = []
        let winningNumbers = []
        try {
          const [nums, addrs] = await pub.readContract({
            address: contractAddress,
            abi,
            functionName: "getWinners",
            args: [i]
          })
          winners = addrs
          winningNumbers = nums
          stats.drawn++
        } catch (e) {
          // No winners yet
        }
        
        competitions.push({
          id: i.toString(),
          totalTickets: totalTickets.toString(),
          ticketsSold: ticketsSold.toString(),
          pricePerTicket: pricePerTicket.toString(),
          endTime: Number(endTime),
          isEnded,
          active,
          drawn,
          numWinners: numWinners.toString(),
          maxTicketsPerTx: maxTicketsPerTx.toString(),
          totalCollected: totalCollected.toString(),
          winners: winners.map(w => w.toString()),
          winningNumbers: winningNumbers.map(n => n.toString()),
          timeRemaining: isEnded ? 0 : Number(endTime) - now
        })
        
      } catch (e) {
        // Competition might not exist, skip
        console.log(`⚠️ Competition ${i} error: ${e.message}`)
      }
    }
    
    // Sort by most recent
    competitions.sort((a, b) => parseInt(b.id) - parseInt(a.id))
    
    // Get recent competitions (last 10)
    const recentCompetitions = competitions.slice(0, 10)
    
    // Get pending draws (ended but not drawn)
    const pendingDraws = competitions.filter(c => c.isEnded && !c.drawn && c.ticketsSold > 0)
    
    // Get active competitions
    const activeCompetitions = competitions.filter(c => c.active && !c.isEnded)
    
    // Summary data
    const summary = {
      contract: {
        address: contractAddress,
        owner: owner,
        balanceEth: Number(contractBalance) / 1e18,
        rpc: baseRpc
      },
      stats,
      pendingDraws: pendingDraws.length,
      activeCompetitions: activeCompetitions.length,
      totalCollected: competitions.reduce((sum, c) => sum + parseInt(c.totalCollected), 0),
      totalWinners: competitions.reduce((sum, c) => sum + c.winners.length, 0)
    }
    
    const dashboard = {
      summary,
      recentCompetitions,
      pendingDraws,
      activeCompetitions,
      timestamp: new Date().toISOString()
    }
    
    console.log(`✅ Monitor complete: ${stats.total} competitions, ${pendingDraws.length} pending draws`)
    
    return new Response(JSON.stringify({ 
      ok: true, 
      data: dashboard,
      message: `Monitor complete: ${stats.total} competitions, ${pendingDraws.length} pending draws`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('Error in competition monitor:', error)
    return new Response(JSON.stringify({
      ok: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})