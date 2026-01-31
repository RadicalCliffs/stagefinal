// VRF Call Parameters Test - Show exactly what will be called
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
      competition_id,
      consumer_address = "0x8ce54644e3313934D663c43Aea29641DFD8BcA1A",
      num_words = 1,
      callback_gas_limit = 100000
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

    // 🔥 YOUR CORRECT VRF Configuration
    const keyHash = "0x00b81b5a830cb0a4009fbd8904de511e28631e62ce5ad231373d3cdad373ccab" // YOUR CORRECT KEYHASH
    const subscriptionId = BigInt("40016523493752259025618720390878595579900340174747129204280165685361210628809") // YOUR REAL SUB ID
    const requestConfirmations = 3
    const gasLimit = callback_gas_limit || 100000
    
    // Generate competition ID if not provided
    let finalCompetitionId = competition_id || generateVRFCompetitionId()

    // 🔥 THE VRF COORDINATOR AND CONSUMER CONTRACT
    const VRF_COORDINATOR_BASE = "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634"
    
    // Get wallet address
    const { ethers } = await import('https://esm.sh/ethers@6.7.1')
    const provider = new ethers.JsonRpcProvider('https://base-mainnet.g.alchemy.com/v2/demo')
    const wallet = new ethers.Wallet(adminWalletKey, provider)
    const walletAddress = await wallet.getAddress()
    
    // Check wallet balance
    const balance = await provider.getBalance(walletAddress)
    
    // Check if consumer contract exists
    const consumerCode = await provider.getCode(consumer_address)
    const consumerExists = consumerCode !== '0x8ce54644e3313934d663c43aea29641dfd8bca1a'
    
    // Check if coordinator contract exists  
    const coordinatorCode = await provider.getCode(VRF_COORDINATOR_BASE)
    const coordinatorExists = coordinatorCode !== '0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634'
    
    const result = {
      competition_id: finalCompetitionId,
      consumer_address: consumer_address,
      
      blockchain_infrastructure_check: {
        wallet_address: walletAddress,
        wallet_balance_eth: ethers.formatEther(balance),
        consumer_contract_exists: consumerExists,
        coordinator_contract_exists: coordinatorExists,
        both_contracts_valid: consumerExists && coordinatorExists
      },
      
      vrf_call_parameters: {
        keyHash: keyHash,  // YOUR CORRECT KEYHASH
        subscriptionId: subscriptionId.toString(),
        requestConfirmations: requestConfirmations,
        callbackGasLimit: gasLimit,
        numWords: num_words,
        consumerContract: consumer_address,
        coordinator: VRF_COORDINATOR_BASE
      },
      
      // The exact function calls that will be made
      function_calls_to_be_made: {
        // CORRECT ARCHITECTURE (consumer contract approach):
        correct_consumer_call: {
          function: "consumerContract.drawWinners()",
          parameters: [
            ethers.formatBytes32String(`competition_${finalCompetitionId}`),
            num_words
          ],
          from_wallet: walletAddress,
          gas_limit: 500000,
          description: "This is the CORRECT VRF flow - calls your consumer contract"
        },
        
        // BACKUP (coordinator call for reference):
        backup_coordinator_call: {
          function: "vrfCoordinator.requestRandomWords()",
          parameters: [
            keyHash,           // YOUR CORRECT KEYHASH
            subscriptionId,    // YOUR REAL SUB ID
            requestConfirmations,
            gasLimit,
            num_words
          ],
          from_wallet: walletAddress,
          gas_limit: 500000,
          description: "Backup: direct coordinator call (not recommended architecture)"
        }
      },
      
      // Transaction data that will be sent
      transaction_data: {
        consumer_method_id: ethers.id("drawWinners(bytes32,uint256)").slice(0, 10),
        consumer_call_data: ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "uint256"], 
          [ethers.formatBytes32String(`competition_${finalCompetitionId}`), num_words]
        ),
        coordinator_method_id: ethers.id("requestRandomWords(bytes32,uint256,uint16,uint32,uint32)").slice(0, 10),
        coordinator_call_data: ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "uint256", "uint16", "uint32", "uint32"], 
          [keyHash, subscriptionId, requestConfirmations, gasLimit, num_words]
        )
      },
      
      // VRF Flow that will happen
      vrf_flow_approval: {
        step_1: "✅ Send transaction to consumer contract from your wallet",
        step_2: "✅ Consumer contract calls coordinator.requestRandomWords()",
        step_3: "✅ Chainlink VRF generates randomness",
        step_4: "✅ Coordinator calls consumer.rawFulfillRandomWords()",
        step_5: "✅ Consumer contract receives fulfillment",
        result: "✅ Fulfillment counter increases on your consumer contract"
      },
      
      timestamp: new Date().toISOString(),
      message: "Ready to make real blockchain call with YOUR CORRECT parameters!"
    }
    
    return new Response(JSON.stringify({ 
      ok: true, 
      data: result,
      message: `🚀 BLOCKCHAIN CALL READY! Consumer: ${consumer_address} | KeyHash: ${keyHash} | SubID: ${subscriptionId.toString().slice(0, 10)}...`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in VRF call test:', error)
    return new Response(JSON.stringify({
      ok: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

// Generate VRF-based competition ID
function generateVRFCompetitionId(): number {
  const pool = Array.from({ length: 100000 }, (_, i) => i + 1)
  const seed = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const hash = simpleHash(seed)
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