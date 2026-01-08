// VRF Admin Lucky Dip Allocation - Based on user's source of truth
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
    const { 
      competitionId,
      recipientAddress,
      ticketCount = 1,
      bulkRecipients = []
    } = requestData

    // Validate required parameters
    if (!competitionId || (!recipientAddress && bulkRecipients.length === 0)) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'competitionId and either recipientAddress or bulkRecipients are required' 
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

    // User's correct ABI from source of truth (assuming lucky dip function exists)
    // Note: This might need to be adjusted based on the actual contract ABI
    const abi = parseAbi([
      "function allocateLuckyDip(uint256 competitionId,address recipient,uint32 ticketCount) external",
      "function bulkAllocateLuckyDip(uint256 competitionId,address[] recipients,uint32[] ticketCounts) external",
      "function competitions(uint256) view returns (uint256,uint256,uint256,uint256,bool,bool,uint8,uint32,uint256)"
    ])

    console.log('🎁 Lucky Dip Allocation...')
    console.log('Contract:', contractAddress)
    console.log('Admin:', admin.address)
    
    // Verify competition exists and is active
    try {
      const c = await pub.readContract({
        address: contractAddress,
        abi,
        functionName: "competitions",
        args: [BigInt(competitionId)]
      })
      
      const totalTickets = c[0]
      const ticketsSold = c[1]
      const active = c[4]
      const drawn = c[5]
      
      if (!active) {
        return new Response(JSON.stringify({ 
          ok: false, 
          error: 'Competition is not active' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      if (drawn) {
        return new Response(JSON.stringify({ 
          ok: false, 
          error: 'Competition has already been drawn' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      console.log('✅ Competition verified - Active, not drawn')
      
    } catch (e) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: `Competition ${competitionId} not found or error: ${e.message}` 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    let results = []
    
    if (bulkRecipients.length > 0) {
      // Bulk allocation
      console.log(`📦 Bulk allocating to ${bulkRecipients.length} recipients...`)
      
      // Validate bulk data
      if (!Array.isArray(bulkRecipients) || bulkRecipients.some(r => !r.address || !r.tickets)) {
        return new Response(JSON.stringify({ 
          ok: false, 
          error: 'bulkRecipients must be array of {address, tickets} objects' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
      const recipients = bulkRecipients.map(r => r.address)
      const ticketCounts = bulkRecipients.map(r => BigInt(r.tickets))
      
      try {
        const bulkHash = await wallet.writeContract({
          address: contractAddress,
          abi,
          functionName: "bulkAllocateLuckyDip",
          args: [BigInt(competitionId), recipients, ticketCounts],
        })
        
        console.log('Bulk TX:', bulkHash)
        const receipt = await pub.waitForTransactionReceipt({ hash: bulkHash })
        
        results.push({
          type: 'bulk',
          transactionHash: bulkHash,
          blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(),
          recipientsCount: recipients.length,
          totalTicketsAllocated: ticketCounts.reduce((sum, count) => sum + Number(count), 0)
        })
        
        console.log(`✅ Bulk allocation completed - ${recipients.length} recipients`)
        
      } catch (e) {
        console.log('❌ Bulk allocation failed:', e.shortMessage || e.message)
        return new Response(JSON.stringify({ 
          ok: false, 
          error: `Bulk allocation failed: ${e.shortMessage || e.message}` 
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      
    } else {
      // Single allocation
      console.log(`🎯 Allocating ${ticketCount} tickets to ${recipientAddress}...`)
      
      try {
        const singleHash = await wallet.writeContract({
          address: contractAddress,
          abi,
          functionName: "allocateLuckyDip",
          args: [BigInt(competitionId), recipientAddress, BigInt(ticketCount)],
        })
        
        console.log('Single TX:', singleHash)
        const receipt = await pub.waitForTransactionReceipt({ hash: singleHash })
        
        results.push({
          type: 'single',
          transactionHash: singleHash,
          blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(),
          recipient: recipientAddress,
          ticketsAllocated: ticketCount
        })
        
        console.log(`✅ Single allocation completed`)
        
      } catch (e) {
        console.log('❌ Single allocation failed:', e.shortMessage || e.message)
        return new Response(JSON.stringify({ 
          ok: false, 
          error: `Single allocation failed: ${e.shortMessage || e.message}` 
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }
    
    const response = {
      ok: true,
      competitionId: competitionId.toString(),
      results,
      explorerUrl: results[0] ? `https://basescan.org/tx/${results[0].transactionHash}` : null,
      contractAddress,
      adminAddress: admin.address,
      timestamp: new Date().toISOString(),
      message: `Lucky dip allocation completed successfully!`
    }
    
    console.log('🎉 Lucky dip allocation completed!')
    
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('Error in lucky dip allocation:', error)
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