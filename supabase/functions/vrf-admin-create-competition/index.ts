// VRF Admin Create Competition - Based on user's source of truth
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createPublicClient, createWalletClient, http, parseAbi, parseEther } from 'https://esm.sh/viem'
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
    const { 
      totalTickets,
      pricePerTicketEth = "0.001",
      numWinners = 1,
      durationMinutes = 60,
      instantWin = false,
      winningNumbers = [],
      maxTicketsPerTx = 10
    } = requestData

    // Validate required parameters
    if (!totalTickets || !numWinners) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'totalTickets and numWinners are required' 
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
      "function createCompetition(uint256 totalTickets,uint256 pricePerTicketWei,uint256 endTime,uint8 numWinners,uint32 maxTicketsPerTx) external returns (uint256)",
      "function nextCompetitionId() view returns (uint256)",
      "event CompetitionCreated(uint256 indexed competitionId,uint256 totalTickets,uint256 pricePerTicketWei,uint256 endTime,uint8 numWinners,uint32 maxTicketsPerTx)"
    ])

    console.log('🏗️ Creating competition...')
    console.log('Contract:', contractAddress)
    console.log('Admin:', admin.address)
    
    // Calculate end time
    const now = Math.floor(Date.now() / 1000)
    const endTime = BigInt(now + (durationMinutes * 60))
    
    // Convert price to wei
    const pricePerTicketWei = parseEther(pricePerTicketEth)
    
    // Prepare creation parameters
    const createParams = [
      BigInt(totalTickets),     // totalTickets
      pricePerTicketWei,        // pricePerTicketWei
      endTime,                  // endTime
      BigInt(numWinners),       // numWinners
      BigInt(maxTicketsPerTx)   // maxTicketsPerTx
    ]
    
    console.log('📊 Competition Parameters:')
    console.log('- Total Tickets:', totalTickets)
    console.log('- Price per Ticket:', pricePerTicketEth, 'ETH')
    console.log('- Number of Winners:', numWinners)
    console.log('- Duration:', durationMinutes, 'minutes')
    console.log('- End Time:', new Date(Number(endTime) * 1000).toISOString())
    console.log('- Max Tickets per TX:', maxTicketsPerTx)
    
    if (instantWin) {
      console.log('- Type: Instant Win')
      if (winningNumbers.length === 0) {
        return new Response(JSON.stringify({ 
          ok: false, 
          error: 'winningNumbers required for instant win competitions' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      console.log('- Winning Numbers:', winningNumbers)
    } else {
      console.log('- Type: Regular Lottery')
    }
    
    // Create the competition
    console.log('\n🚀 Sending createCompetition transaction...')
    const createHash = await wallet.writeContract({
      address: contractAddress,
      abi,
      functionName: "createCompetition",
      args: createParams,
    })
    
    console.log('Create TX:', createHash)
    const createReceipt = await pub.waitForTransactionReceipt({ hash: createHash })
    console.log('✅ Create mined block:', Number(createReceipt.blockNumber))
    
    // Get the new competition ID
    const nextId = await pub.readContract({
      address: contractAddress,
      abi,
      functionName: "nextCompetitionId",
    })
    
    const competitionId = BigInt(nextId) - 1n
    console.log('✅ New Competition ID:', competitionId.toString())
    
    // Extract event data
    const competitionCreated = createReceipt.logs
      .map((log) => {
        try {
          return pub.decodeEventLog({ abi, ...log })
        } catch {
          return null
        }
      })
      .find((x) => x && x.eventName === 'CompetitionCreated')
    
    let eventData = {}
    if (competitionCreated) {
      eventData = {
        totalTickets: competitionCreated.args.totalTickets.toString(),
        pricePerTicketWei: competitionCreated.args.pricePerTicketWei.toString(),
        endTime: Number(competitionCreated.args.endTime),
        numWinners: competitionCreated.args.numWinners.toString(),
        maxTicketsPerTx: competitionCreated.args.maxTicketsPerTx.toString()
      }
    }
    
    const response = {
      ok: true,
      competitionId: competitionId.toString(),
      transactionHash: createHash,
      blockNumber: createReceipt.blockNumber.toString(),
      gasUsed: createReceipt.gasUsed.toString(),
      eventData,
      parameters: {
        totalTickets,
        pricePerTicketEth,
        pricePerTicketWei: pricePerTicketWei.toString(),
        numWinners,
        durationMinutes,
        endTime: endTime.toString(),
        endTimeFormatted: new Date(Number(endTime) * 1000).toISOString(),
        maxTicketsPerTx,
        instantWin,
        winningNumbers: instantWin ? winningNumbers : []
      },
      explorerUrl: `https://basescan.org/tx/${createHash}`,
      contractAddress,
      adminAddress: admin.address,
      timestamp: new Date().toISOString(),
      message: `Competition ${competitionId.toString()} created successfully!`
    }
    
    console.log('🎉 Competition creation completed!')
    
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('Error creating competition:', error)
    return new Response(JSON.stringify({
      ok: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})