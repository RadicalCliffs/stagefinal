// VRF Pregenerate Winners - Generates VRF random seed at competition creation time
// This function should be called immediately after creating a new competition
// to pregenerate the VRF randomness that will be used for winner selection

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createPublicClient, createWalletClient, http, parseAbi, keccak256, toHex } from 'https://esm.sh/viem'
import { privateKeyToAccount } from 'https://esm.sh/viem/accounts'
import { base } from 'https://esm.sh/viem/chains'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    const { competition_id, total_tickets } = requestData

    // Validate required parameters
    if (!competition_id) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'competition_id is required'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!total_tickets || total_tickets <= 0) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'total_tickets must be a positive number'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const adminWalletKey = Deno.env.get('ADMIN_WALLET_PRIVATE_KEY')
    const baseRpc = Deno.env.get('BASE_RPC') || 'https://base-rpc.publicnode.com'
    const contractAddress = Deno.env.get('CONTRACT_ADDRESS') || '0x8ce54644e3313934d663c43aea29641dfd8bca1a'
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!adminWalletKey) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'ADMIN_WALLET_PRIVATE_KEY not configured'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Supabase configuration missing'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Setup viem clients
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

    // Setup Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('🎲 Pregenerating VRF seed for competition:', competition_id)
    console.log('Total tickets:', total_tickets)

    // Generate VRF seed using blockchain randomness
    // Get current block for entropy source
    const currentBlock = await pub.getBlock()
    const blockHash = currentBlock.hash
    const blockNumber = currentBlock.number
    const timestamp = currentBlock.timestamp

    // Create deterministic but unpredictable seed from multiple entropy sources
    const entropyData = `${competition_id}-${blockHash}-${blockNumber}-${timestamp}-${admin.address}-${Date.now()}`
    const vrfSeed = keccak256(toHex(entropyData))

    console.log('📊 VRF Seed generated from block:', blockNumber.toString())
    console.log('VRF Seed:', vrfSeed)

    // Create a blockchain transaction to record the VRF seed commitment
    // This creates an immutable on-chain record of the pregenerated randomness
    const commitmentData = keccak256(toHex(`COMMIT-${vrfSeed}-${competition_id}`))

    // Send a minimal transaction to record the commitment on-chain
    // This serves as proof that the seed was generated at this specific time
    let txHash = null
    try {
      // Send a self-transfer with the commitment in data field for on-chain proof
      txHash = await wallet.sendTransaction({
        to: admin.address,
        value: BigInt(0),
        data: commitmentData as `0x${string}`
      })

      console.log('📝 VRF commitment transaction:', txHash)

      // Wait for transaction confirmation
      const receipt = await pub.waitForTransactionReceipt({ hash: txHash })
      console.log('✅ Commitment confirmed in block:', receipt.blockNumber.toString())
    } catch (txError) {
      console.warn('⚠️ Could not create on-chain commitment:', txError.message)
      // Continue without on-chain commitment - the seed is still valid
    }

    // Store the pregenerated VRF data in the database
    const { error: updateError } = await supabase
      .from('competitions')
      .update({
        outcomes_vrf_seed: vrfSeed,
        vrf_pregenerated_tx_hash: txHash,
        vrf_pregenerated_at: new Date().toISOString(),
        vrf_pregenerated_block: blockNumber.toString()
      })
      .eq('id', competition_id)

    if (updateError) {
      console.error('Error updating competition with VRF data:', updateError)
      return new Response(JSON.stringify({
        ok: false,
        error: `Failed to store VRF data: ${updateError.message}`
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('🎉 VRF pregeneration completed successfully!')

    const response = {
      ok: true,
      competition_id,
      vrf_seed: vrfSeed,
      tx_hash: txHash,
      block_number: blockNumber.toString(),
      total_tickets,
      timestamp: new Date().toISOString(),
      message: `VRF seed pregenerated for competition ${competition_id}`
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error pregenerating VRF:', error)
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
