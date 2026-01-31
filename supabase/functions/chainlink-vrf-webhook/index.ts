import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get webhook data
    const webhookData = await req.json();
    
    console.log('VRF Webhook received:', JSON.stringify(webhookData, null, 2));

    // Extract VRF data from webhook
    const { 
      requestId, 
      randomNumber, 
      txHash, 
      status = 'fulfilled',
      competitionId,
      subscriptionId,
    } = webhookData;

    if (!requestId || !randomNumber) {
      return new Response(
        JSON.stringify({ error: { code: 'MISSING_VRF_DATA', message: 'Request ID and random number are required' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify subscription ID (optional security check)
    const expectedSubscriptionId = '40016523493752259025618720390878595579900340174747129204280165685361210628809';
    if (subscriptionId && subscriptionId !== expectedSubscriptionId) {
      console.error('Invalid subscription ID:', subscriptionId);
      return new Response(
        JSON.stringify({ error: { code: 'INVALID_SUBSCRIPTION', message: 'Invalid subscription ID' } }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate requestId format
    if (!requestId || typeof requestId !== 'string') {
      return new Response(
        JSON.stringify({ error: { code: 'INVALID_REQUEST_ID', message: 'Request ID is required and must be a string' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find the trigger record
    const { data: trigger, error: triggerError } = await supabase
      .from("rng_triggers")
      .select("*")
      .eq("vrf_request_id", requestId)
      .single();

    if (triggerError || !trigger) {
      console.error('Trigger not found for requestId:', requestId);
      return new Response(
        JSON.stringify({ error: { code: 'TRIGGER_NOT_FOUND', message: 'VRF trigger not found' } }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update trigger with VRF result
    const updateData = {
      random_number: randomNumber,
      vrf_status: status,
      vrf_tx_hash: txHash || `0x${Math.random().toString(16).substring(2, 64)}`,
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from("rng_triggers")
      .update(updateData)
      .eq("id", trigger.id);

    if (updateError) {
      console.error('Failed to update trigger:', updateError);
      return new Response(
        JSON.stringify({ error: { code: 'UPDATE_FAILED', message: 'Failed to update VRF trigger' } }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get competition and participants
    const competitionIdToUse = competitionId || trigger.competition_id;
    
    // Try both competitions and raffle_competitions tables
    let { data: competition, error: compError } = await supabase
      .from("competitions")
      .select("*")
      .eq("id", competitionIdToUse)
      .single();

    if (compError || !competition) {
      // Try raffle_competitions table
      const { data: raffleComp, error: raffleError } = await supabase
        .from("raffle_competitions")
        .select("*")
        .eq("id", competitionIdToUse)
        .single();

      if (raffleError || !raffleComp) {
        console.error('Competition not found for ID:', competitionIdToUse);
        return new Response(
          JSON.stringify({ 
            error: { code: 'COMPETITION_NOT_FOUND', message: 'Competition not found' },
            data: { triggerId: trigger.id, requestId }
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      competition = raffleComp;
    }

    // Get all participants for this competition
    const { data: participants, error: participantsError } = await supabase
      .from("joincompetition")
      .select("*")
      .eq("competitionid", competitionIdToUse);

    if (participantsError) {
      console.error('Error fetching participants:', participantsError);
      return new Response(
        JSON.stringify({ 
          error: { code: 'PARTICIPANTS_ERROR', message: 'Failed to fetch participants' } 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!participants || participants.length === 0) {
      console.error('No participants found for competition:', competitionIdToUse);
      return new Response(
        JSON.stringify({ 
          success: true,
          data: { 
            requestId,
            competitionId: competitionIdToUse,
            message: 'VRF processed but no participants found',
            triggerId: trigger.id,
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Select winner using random number modulo participant count
    const randomValue = parseInt(randomNumber.replace('0x', '').substring(0, 8), 16);
    const winnerIndex = randomValue % participants.length;
    const winner = participants[winnerIndex];

    if (!winner) {
      throw new Error('Invalid winner selection');
    }

    // Parse ticket numbers to get the first one for winner record
    const ticketNumbers = winner.ticketnumbers ? winner.ticketnumbers.split(',') : ['1'];
    const winningTicket = ticketNumbers[0] || '1';

    // Update competition with winner (handle both table types)
    if (competition.hasOwnProperty('raffle_competitions') || competition.status === 'active') {
      // Update raffle_competitions table
      const { error: raffleUpdateError } = await supabase
        .from("raffle_competitions")
        .update({
          winner_address: winner.wallet_address,
          winning_ticket_id: winningTicket,
          status: 'completed',
          completed_at: new Date().toISOString(),
          rng_random_number: randomNumber,
          rng_tx_hash: txHash,
          updated_at: new Date().toISOString(),
        })
        .eq("id", competitionIdToUse);

      if (raffleUpdateError) {
        console.error('Failed to update raffle competition winner:', raffleUpdateError);
      }
    } else {
      // Update regular competitions table
      const { error: compUpdateError } = await supabase
        .from("competitions")
        .update({
          winner_address: winner.wallet_address,
          winning_ticket_id: winningTicket,
          status: 'completed',
          completed_at: new Date().toISOString(),
          rng_random_number: randomNumber,
          rng_tx_hash: txHash,
          updated_at: new Date().toISOString(),
        })
        .eq("id", competitionIdToUse);

      if (compUpdateError) {
        console.error('Failed to update competition winner:', compUpdateError);
      }
    }

    // Create winner record (if it doesn't exist)
    const { data: existingWinner } = await supabase
      .from("winners")
      .select("id")
      .eq("competition_id", competitionIdToUse)
      .eq("wallet_address", winner.wallet_address)
      .maybeSingle();

    if (!existingWinner) {
      const { error: winnerRecordError } = await supabase
        .from("winners")
        .insert({
          competition_id: competitionIdToUse,
          wallet_address: winner.wallet_address,
          ticket_id: winningTicket,
          random_number: randomNumber,
          vrf_tx_hash: txHash,
          claimed: false,
          created_at: new Date().toISOString(),
        });

      if (winnerRecordError) {
        console.error('Failed to create winner record:', winnerRecordError);
        // Don't fail the whole process for this
      }
    }

    // Log successful processing
    console.log('VRF processed successfully:', {
      requestId,
      competitionId: competitionIdToUse,
      winnerAddress: winner.wallet_address,
      winningTicket,
      randomNumber,
      txHash,
      participantCount: participants.length,
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          requestId,
          competitionId: competitionIdToUse,
          winner: {
            address: winner.wallet_address,
            ticketId: winningTicket,
            ticketNumbers: ticketNumbers,
          },
          randomNumber,
          txHash,
          status: 'processed',
          participantCount: participants.length,
          triggerId: trigger.id,
          message: 'VRF randomness processed and winner selected successfully',
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('VRF webhook error:', error);
    return new Response(
      JSON.stringify({
        error: {
          code: 'VRF_WEBHOOK_ERROR',
          message: error.message || 'Internal server error'
        }
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
