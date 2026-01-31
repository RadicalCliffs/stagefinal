// VRF v2.5 End-to-End Proof Test
// Supabase Edge Function based on prove_vrf.mjs

import { createClient, createPublicClient, createWalletClient, http, parseAbi } from 'https://esm.sh/viem@2.43.2'
import { privateKeyToAccount } from 'https://esm.sh/viem@2.43.2/accounts'
import { base } from 'https://esm.sh/viem@2.43.2/chains'

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control, pragma, expires',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE, PATCH',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'false'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // Environment variables
    const RPC = Deno.env.get('BASE_RPC');
    const CONTRACT = Deno.env.get('VRF_CONSUMER_ADDRESS');
    const ADMIN_PK = Deno.env.get('ADMIN_WALLET_PRIVATE_KEY');

    if (!RPC || !CONTRACT || !ADMIN_PK) {
      return new Response(
        JSON.stringify({ 
          error: 'Missing BASE_RPC / VRF_CONSUMER_ADDRESS / ADMIN_WALLET_PRIVATE_KEY environment variables' 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Setup account and clients
    const admin = privateKeyToAccount(ADMIN_PK);

    // VRF v2.5 Contract ABI
    const abi = parseAbi([
      // VRF v2.5 functions
      "function requestRandomWords() external returns (uint256)",
      "function lastRequestId() view returns (uint256)",
      "function lastRandomWords() view returns (uint256[])",
      "function subscriptionId() view returns (uint256)",
      "function keyHash() view returns (bytes32)",
      "function callbackGasLimit() view returns (uint32)",
      "function requestConfirmations() view returns (uint16)",
      "function numWords() view returns (uint32)",
      
      // Events
      "event Requested(uint256 requestId)",
      "event Fulfilled(uint256 requestId, uint256[] randomWords)",
    ]);

    const pub = createPublicClient({
      chain: base,
      transport: http(RPC),
    });

    const wallet = createWalletClient({
      chain: base,
      transport: http(RPC),
      account: admin,
    });

    const results = {
      status: 'started',
      timestamp: new Date().toISOString(),
      rpc: RPC,
      chainId: base.id,
      admin: admin.address,
      contract: CONTRACT,
      steps: []
    };

    // Step 1: Check VRF v2.5 configuration
    results.steps.push({
      step: 'configuration',
      status: 'reading',
      timestamp: new Date().toISOString()
    });

    try {
      const subscriptionId = await pub.readContract({
        address: CONTRACT,
        abi,
        functionName: "subscriptionId",
      });
      
      const keyHash = await pub.readContract({
        address: CONTRACT,
        abi,
        functionName: "keyHash",
      });
      
      const callbackGasLimit = await pub.readContract({
        address: CONTRACT,
        abi,
        functionName: "callbackGasLimit",
      });
      
      const requestConfirmations = await pub.readContract({
        address: CONTRACT,
        abi,
        functionName: "requestConfirmations",
      });
      
      const numWords = await pub.readContract({
        address: CONTRACT,
        abi,
        functionName: "numWords",
      });

      results.steps[results.steps.length - 1] = {
        step: 'configuration',
        status: 'success',
        timestamp: new Date().toISOString(),
        data: {
          subscriptionId: subscriptionId.toString(),
          keyHash,
          callbackGasLimit: callbackGasLimit.toString(),
          requestConfirmations: requestConfirmations.toString(),
          numWords: numWords.toString()
        }
      };

    } catch (error) {
      results.steps[results.steps.length - 1] = {
        step: 'configuration',
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message
      };
      
      return new Response(
        JSON.stringify(results),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Check current state
    results.steps.push({
      step: 'current_state',
      status: 'reading',
      timestamp: new Date().toISOString()
    });

    try {
      const currentRequestId = await pub.readContract({
        address: CONTRACT,
        abi,
        functionName: "lastRequestId",
      });
      
      let currentRandomWords = [];
      try {
        currentRandomWords = await pub.readContract({
          address: CONTRACT,
          abi,
          functionName: "lastRandomWords",
        });
      } catch (error) {
        // This is expected if no request has been made yet
        console.log('No previous VRF request found - this is normal for first test');
      }

      results.steps[results.steps.length - 1] = {
        step: 'current_state',
        status: 'success',
        timestamp: new Date().toISOString(),
        data: {
          currentRequestId: currentRequestId.toString(),
          currentRandomWords: currentRandomWords.map ? currentRandomWords.map(n => n.toString()) : []
        }
      };

    } catch (error) {
      results.steps[results.steps.length - 1] = {
        step: 'current_state',
        status: 'warning',
        timestamp: new Date().toISOString(),
        message: 'Could not read current state, proceeding with request',
        error: error.message
      };
    }

    // Step 3: Request new random words
    results.steps.push({
      step: 'request',
      status: 'sending',
      timestamp: new Date().toISOString()
    });

    try {
      const requestHash = await wallet.writeContract({
        address: CONTRACT,
        abi,
        functionName: "requestRandomWords",
      });

      const requestReceipt = await pub.waitForTransactionReceipt({ hash: requestHash });

      results.steps[results.steps.length - 1] = {
        step: 'request',
        status: 'success',
        timestamp: new Date().toISOString(),
        data: {
          requestHash,
          requestBlockNumber: Number(requestReceipt.blockNumber),
          gasUsed: requestReceipt.gasUsed.toString()
        }
      };

    } catch (error) {
      results.steps[results.steps.length - 1] = {
        step: 'request',
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message
      };
      
      return new Response(
        JSON.stringify(results),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 4: Poll for fulfillment (simplified for Edge Function)
    results.steps.push({
      step: 'fulfillment',
      status: 'polling',
      timestamp: new Date().toISOString(),
      message: 'Checking for VRF fulfillment (simplified polling)'
    });

    try {
      // Simple check - wait a bit and then check for results
      await new Promise(resolve => setTimeout(resolve, 15000)); // Wait 15 seconds

      const finalRequestId = await pub.readContract({
        address: CONTRACT,
        abi,
        functionName: "lastRequestId",
      });
      
      const finalRandomWords = await pub.readContract({
        address: CONTRACT,
        abi,
        functionName: "lastRandomWords",
      });

      const isFulfilled = finalRandomWords.length > 0 && finalRandomWords[0] > 0n;

      results.steps[results.steps.length - 1] = {
        step: 'fulfillment',
        status: isFulfilled ? 'success' : 'pending',
        timestamp: new Date().toISOString(),
        data: {
          finalRequestId: finalRequestId.toString(),
          finalRandomWords: finalRandomWords.map(n => n.toString()),
          isFulfilled,
          randomValue: finalRandomWords.length > 0 ? finalRandomWords[0].toString() : null
        }
      };

      results.status = isFulfilled ? 'fulfilled' : 'pending';
      results.message = isFulfilled ? 'VRF v2.5 fulfilled successfully!' : 'VRF request sent, fulfillment pending';

    } catch (error) {
      results.steps[results.steps.length - 1] = {
        step: 'fulfillment',
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }

    return new Response(
      JSON.stringify(results),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});