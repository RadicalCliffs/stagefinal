// VRF Parameters Show - Just show the parameters without blockchain calls
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
      competition_id,
      consumer_address = "0x8ce54644e3313934D663c43Aea29641DFD8BcA1A",
      num_words = 1,
      callback_gas_limit = 100000
    } = requestData

    // 🔥 YOUR CORRECT VRF Configuration
    const keyHash = "0x00b81b5a830cb0a4009fbd8904de511e28631e62ce5ad231373d3cdad373ccab" // YOUR CORRECT KEYHASH
    const subscriptionId = "40016523493752259025618720390878595579900340174747129204280165685361210628809" // YOUR REAL SUB ID
    const requestConfirmations = 3
    const gasLimit = callback_gas_limit || 100000
    
    // Generate competition ID if not provided
    let finalCompetitionId = competition_id || generateVRFCompetitionId()

    // 🔥 THE VRF COORDINATOR AND CONSUMER CONTRACT
    const VRF_COORDINATOR_BASE = "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634"
    
    const result = {
      competition_id: finalCompetitionId,
      consumer_address: consumer_address,
      
      // ✅ YOUR CORRECT VRF PARAMETERS
      vrf_call_parameters: {
        keyHash: keyHash,  // YOUR CORRECT KEYHASH for 2 gwei
        subscriptionId: subscriptionId,
        requestConfirmations: requestConfirmations,
        callbackGasLimit: gasLimit,
        numWords: num_words,
        consumerContract: consumer_address,
        coordinator: VRF_COORDINATOR_BASE
      },
      
      // The exact function calls that will be made
      blockchain_calls_to_be_made: {
        // CORRECT VRF ARCHITECTURE:
        correct_consumer_call: {
          function: "consumerContract.drawWinners(bytes32 competitionId, uint256 numWords)",
          parameters: [
            `competition_${finalCompetitionId}`,  // Will be converted to bytes32
            num_words
          ],
          gas_limit: 500000,
          description: "✅ CORRECT: Calls your consumer contract, which then calls VRF coordinator"
        },
        
        // BACKUP COORDINATOR CALL:
        backup_coordinator_call: {
          function: "vrfCoordinator.requestRandomWords(bytes32 keyHash, uint256 subId, uint16 requestConfirmations, uint32 callbackGasLimit, uint32 numWords)",
          parameters: [
            keyHash,           // YOUR CORRECT KEYHASH
            subscriptionId,    // YOUR REAL SUB ID
            requestConfirmations,
            gasLimit,
            num_words
          ],
          gas_limit: 500000,
          description: "⚠️ BACKUP: Direct coordinator call (not recommended VRF architecture)"
        }
      },
      
      // VRF Flow that will happen
      vrf_flow_process: {
        step_1: "✅ Send transaction to your consumer contract from your wallet",
        step_2: "✅ Consumer contract internally calls coordinator.requestRandomWords()",
        step_3: "✅ Chainlink VRF generates provable randomness",
        step_4: "✅ VRF coordinator calls back to consumer.rawFulfillRandomWords()",
        step_5: "✅ Consumer contract receives random words and processes them",
        step_6: "✅ Fulfillment counter increases on your consumer contract",
        result: "✅ Random numbers available for your competition winners"
      },
      
      // Blockchain infrastructure
      blockchain_infrastructure: {
        network: "Base Mainnet",
        chain_id: "8453",
        consumer_contract: consumer_address,
        coordinator_contract: VRF_COORDINATOR_BASE,
        keyhash_type: "2 gwei option",
        vrf_version: "Chainlink VRF v2.5"
      },
      
      // Transaction details
      transaction_details: {
        consumer_method_selector: "0x8d6c2b0b", // drawWinners(bytes32,uint256)
        coordinator_method_selector: "0xd33d44c1", // requestRandomWords(bytes32,uint256,uint16,uint32,uint32)
        estimated_gas: "500,000",
        estimated_cost: "~0.05 ETH"
      },
      
      timestamp: new Date().toISOString(),
      message: `🚀 REAL BLOCKCHAIN CALL READY! Competition: ${finalCompetitionId}`
    }
    
    return new Response(JSON.stringify({ 
      ok: true, 
      data: result,
      message: `🔥 BLOCKCHAIN CALL PREPARED! Consumer: ${consumer_address} | KeyHash: ${keyHash} | Competition: ${finalCompetitionId}`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in VRF parameters:', error)
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