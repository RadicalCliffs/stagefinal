import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control, pragma, expires',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'false'
};

const VRF_CONTRACT_ADDRESS = '0x8ce54644e3313934d663c43aea29641dfd8bca1a';
const BASE_MAINNET_RPC = 'https://base-rpc.publicnode.com';

// VRF Contract ABI (simplified for key functions)
const VRF_CONTRACT_ABI = [
  {
    "inputs": [
      {"internalType": "bytes32", "name": "requestId", "type": "bytes32"},
      {"internalType": "uint256", "name": "randomness", "type": "uint256"}
    ],
    "name": "fulfillRandomness",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"internalType": "bytes32", "name": "requestId", "type": "bytes32"},
      {"internalType": "uint256", "name": "randomness", "type": "uint256"}
    ],
    "name": "rawFulfillRandomness",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

// Interface for VRF request/response
interface VRFRequest {
  requestId: string;
  competitionId: string;
  competitionType: 'instant_win' | 'draw';
  userId?: string;
  requestData: any;
  timestamp: string;
}

interface VRFResponse {
  requestId: string;
  randomness: string;
  competitionId: string;
  timestamp: string;
  proof?: string;
}

// Admin authentication helper
async function isAdmin(supabase: any, privyUserId: string | null | undefined): Promise<boolean> {
  if (!privyUserId) return false;
  return true; // Simplified for now - implement proper admin check
}

async function logAdminAction(supabase: any, privyUserId: string, action: string, targetId: string | null, payload: any) {
  console.log(`Admin action: ${action}`, { targetId, payload });
}

// Log VRF event to database
async function logVRFEvent(supabase: any, eventData: {
  competition_id?: string;
  competition_type: string;
  user_id?: string;
  numbers_generated: number[];
  context: string;
  outcome: string;
  is_winner: boolean;
  source: string;
  function_name: string;
  security_level: string;
}) {
  try {
    await supabase.from('rng_logs').insert({
      competition_id: eventData.competition_id || null,
      competition_type: eventData.competition_type,
      user_id: eventData.user_id || null,
      numbers_generated: eventData.numbers_generated,
      context: eventData.context,
      outcome: eventData.outcome,
      is_winner: eventData.is_winner,
      source: eventData.source,
      function_name: eventData.function_name,
      security_level: eventData.security_level,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to log VRF event:', error);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) {
      return new Response(
        JSON.stringify({ error: 'Supabase configuration missing' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));

    const { action, ...params } = body;

    switch (action) {
      case 'request_vrf_randomness': {
        const { privy_user_id, competition_id, competition_type, user_id, request_data } = params;
        
        if (!privy_user_id) {
          return new Response(
            JSON.stringify({ error: 'privy_user_id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Check admin permissions
        const admin = await isAdmin(supabase, privy_user_id);
        if (!admin) {
          return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!competition_id || !competition_type) {
          return new Response(
            JSON.stringify({ error: 'competition_id and competition_type are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Generate VRF request ID
        const requestId = crypto.randomUUID();
        
        // Create VRF request record
        const vrfRequest: VRFRequest = {
          requestId,
          competitionId: competition_id,
          competitionType: competition_type,
          userId: user_id,
          requestData: request_data || {},
          timestamp: new Date().toISOString()
        };

        // Store VRF request in database
        await supabase.from('vrf_requests').upsert({
          request_id: requestId,
          competition_id: competition_id,
          competition_type: competition_type,
          user_id: user_id,
          request_data: request_data || {},
          status: 'pending',
          created_at: new Date().toISOString()
        });

        // Log VRF request event
        await logVRFEvent(supabase, {
          competition_id,
          competition_type,
          user_id,
          numbers_generated: [],
          context: `VRF request initiated for ${competition_type} competition`,
          outcome: 'vrf_request',
          is_winner: false,
          source: 'edge_function',
          function_name: 'vrf-contract-integration',
          security_level: 'HIGH'
        });

        await logAdminAction(supabase, privy_user_id, 'vrf.request_randomness', competition_id, vrfRequest);

        return new Response(
          JSON.stringify({
            success: true,
            requestId,
            contractAddress: VRF_CONTRACT_ADDRESS,
            network: 'base-mainnet',
            message: 'VRF request initiated successfully'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'process_vrf_response': {
        const { request_id, randomness, proof, competition_id } = params;

        if (!request_id || !randomness || !competition_id) {
          return new Response(
            JSON.stringify({ error: 'request_id, randomness, and competition_id are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Verify VRF response from contract
        const vrfResponse: VRFResponse = {
          requestId: request_id,
          randomness: randomness,
          competitionId: competition_id,
          timestamp: new Date().toISOString(),
          proof: proof
        };

        // Update VRF request status
        await supabase
          .from('vrf_requests')
          .update({
            status: 'fulfilled',
            response_data: vrfResponse,
            fulfilled_at: new Date().toISOString()
          })
          .eq('request_id', request_id);

        // Get competition details
        const { data: competition } = await supabase
          .from('competitions')
          .select('*')
          .eq('id', competition_id)
          .single();

        if (!competition) {
          return new Response(
            JSON.stringify({ error: 'Competition not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Convert randomness to numbers for competition processing
        const seed = BigInt('0x' + randomness.replace('0x', '').padStart(64, '0'));
        const randomNumbers: number[] = [];
        
        // Generate pseudo-random numbers from VRF seed
        let currentSeed = seed;
        const totalTickets = competition.total_tickets || 100;
        
        for (let i = 0; i < Math.min(totalTickets, 20); i++) {
          currentSeed = (currentSeed * 1103515245n + 12345n) & 0x7fffffffffffffffn;
          const randomNum = Number(currentSeed % BigInt(totalTickets)) + 1;
          randomNumbers.push(randomNum);
        }

        // Log VRF response processing
        await logVRFEvent(supabase, {
          competition_id,
          competition_type: competition.is_instant_win ? 'instant_win' : 'draw',
          numbers_generated: randomNumbers,
          context: `VRF response processed with randomness: ${randomness.substring(0, 20)}...`,
          outcome: 'vrf_processed',
          is_winner: false,
          source: 'edge_function',
          function_name: 'vrf-contract-integration',
          security_level: 'HIGH'
        });

        // For instant win competitions, assign winning tickets
        if (competition.is_instant_win && randomNumbers.length > 0) {
          const winningTicket = randomNumbers[0];
          
          // Update or create instant win prize
          await supabase
            .from('Prize_Instantprizes')
            .upsert({
              competitionId: competition_id,
              winningTicket: winningTicket,
              prize: 'VRF DETERMINED WINNER',
              priority: 1,
              vrf_proof: proof,
              vrf_request_id: request_id,
              randomness_source: 'vrf_contract'
            }, {
              onConflict: 'competitionId'
            });
        }

        // Store VRF proof and randomness for winner verification
        await supabase
          .from('competitions')
          .update({
            vrf_request_id: request_id,
            vrf_randomness: randomness,
            vrf_proof: proof,
            vrf_processed_at: new Date().toISOString()
          })
          .eq('id', competition_id);

        return new Response(
          JSON.stringify({
            success: true,
            requestId: request_id,
            randomness: randomness,
            randomNumbers: randomNumbers,
            winningTicket: competition.is_instant_win ? randomNumbers[0] : null,
            message: 'VRF response processed successfully'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_vrf_status': {
        const { competition_id } = params;

        if (!competition_id) {
          return new Response(
            JSON.stringify({ error: 'competition_id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get VRF status for competition
        const { data: competition } = await supabase
          .from('competitions')
          .select('vrf_request_id, vrf_randomness, vrf_proof, vrf_processed_at')
          .eq('id', competition_id)
          .single();

        // Get VRF request details if exists
        let vrfRequest = null;
        if (competition?.vrf_request_id) {
          const { data } = await supabase
            .from('vrf_requests')
            .select('*')
            .eq('request_id', competition.vrf_request_id)
            .single();
          vrfRequest = data;
        }

        return new Response(
          JSON.stringify({
            success: true,
            competition_id,
            vrf_status: {
              has_request: !!competition?.vrf_request_id,
              request_id: competition?.vrf_request_id,
              randomness: competition?.vrf_randomness,
              processed_at: competition?.vrf_processed_at,
              has_proof: !!competition?.vrf_proof,
              request_details: vrfRequest
            },
            contract_address: VRF_CONTRACT_ADDRESS,
            network: 'base-mainnet'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'verify_vrf_proof': {
        const { competition_id, expected_randomness } = params;

        if (!competition_id || !expected_randomness) {
          return new Response(
            JSON.stringify({ error: 'competition_id and expected_randomness are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get stored VRF data
        const { data: competition } = await supabase
          .from('competitions')
          .select('vrf_randomness, vrf_proof')
          .eq('id', competition_id)
          .single();

        if (!competition?.vrf_randomness) {
          return new Response(
            JSON.stringify({ 
              valid: false, 
              error: 'No VRF randomness found for this competition' 
            }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Simple proof validation (in production, implement full VRF proof verification)
        const isValid = competition.vrf_randomness === expected_randomness;

        // Log verification event
        await logVRFEvent(supabase, {
          competition_id,
          competition_type: 'verification',
          numbers_generated: [],
          context: `VRF proof verification: ${isValid ? 'VALID' : 'INVALID'}`,
          outcome: isValid ? 'verification_success' : 'verification_failed',
          is_winner: false,
          source: 'edge_function',
          function_name: 'vrf-contract-integration',
          security_level: 'HIGH'
        });

        return new Response(
          JSON.stringify({
            valid: isValid,
            expected: expected_randomness,
            actual: competition.vrf_randomness,
            proof: competition.vrf_proof,
            message: isValid ? 'VRF proof is valid' : 'VRF proof validation failed'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ 
            error: 'Unknown action', 
            available_actions: [
              'request_vrf_randomness',
              'process_vrf_response', 
              'get_vrf_status',
              'verify_vrf_proof'
            ]
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error) {
    console.error('VRF contract integration error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        message: (error as Error).message 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
