// VRF Draw Winner - Selects winner using pregenerated VRF seed
// This function should be called when a competition ends (manually or via cron)
// It uses the VRF seed pregenerated at competition creation time to select the winner

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { keccak256, toHex } from 'https://esm.sh/viem'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    const { competition_id } = requestData

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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Supabase configuration missing'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Setup Supabase client with service role
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    console.log('🎯 Drawing winner for competition:', competition_id)

    // Fetch competition data including pregenerated VRF seed
    const { data: competition, error: fetchError } = await supabase
      .from('competitions')
      .select('id, title, outcomes_vrf_seed, tickets_sold, total_tickets, status, winner_address, end_date')
      .eq('id', competition_id)
      .single()

    if (fetchError || !competition) {
      return new Response(JSON.stringify({
        ok: false,
        error: `Competition not found: ${fetchError?.message || 'Unknown error'}`
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Validate competition state
    if (competition.winner_address) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Winner already selected for this competition',
        winner_address: competition.winner_address
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!competition.outcomes_vrf_seed) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'VRF seed not pregenerated for this competition. Cannot draw winner.'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const ticketsSold = competition.tickets_sold || 0
    if (ticketsSold === 0) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'No tickets sold for this competition'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('📊 Competition data:')
    console.log('- Title:', competition.title)
    console.log('- Tickets sold:', ticketsSold)
    console.log('- VRF Seed:', competition.outcomes_vrf_seed)

    // Use VRF seed to deterministically select winning ticket number
    // This is provably fair - anyone can verify the result using the same seed
    const vrfSeed = competition.outcomes_vrf_seed
    const selectionHash = keccak256(toHex(`SELECT-WINNER-${vrfSeed}-${competition_id}`))

    // Convert hash to a number within ticket range (1 to ticketsSold)
    const hashBigInt = BigInt(selectionHash)
    const winningTicketNumber = Number((hashBigInt % BigInt(ticketsSold)) + BigInt(1))

    console.log('🎫 Winning ticket number:', winningTicketNumber)

    // Find the ticket owner
    const { data: winningTicket, error: ticketError } = await supabase
      .from('tickets')
      .select('user_id, wallet_address')
      .eq('competition_id', competition_id)
      .eq('ticket_number', winningTicketNumber)
      .single()

    let winnerAddress = null
    let winnerUserId = null

    if (winningTicket) {
      winnerAddress = winningTicket.wallet_address
      winnerUserId = winningTicket.user_id
      console.log('🏆 Winner found:', winnerAddress)
    } else {
      // Try alternative ticket lookup via purchased_tickets or other tables
      const { data: altTicket } = await supabase
        .from('purchased_tickets')
        .select('user_id, wallet_address')
        .eq('competition_id', competition_id)
        .contains('ticket_numbers', [winningTicketNumber])
        .single()

      if (altTicket) {
        winnerAddress = altTicket.wallet_address
        winnerUserId = altTicket.user_id
        console.log('🏆 Winner found (alt lookup):', winnerAddress)
      }
    }

    if (!winnerAddress) {
      console.warn('⚠️ Could not find ticket owner for winning ticket:', winningTicketNumber)
    }

    // Update competition with winner information
    const { error: updateError } = await supabase
      .from('competitions')
      .update({
        winner_address: winnerAddress,
        winner_ticket_number: winningTicketNumber,
        status: 'drawn',
        drawn_at: new Date().toISOString()
      })
      .eq('id', competition_id)

    if (updateError) {
      console.error('Error updating competition:', updateError)
      return new Response(JSON.stringify({
        ok: false,
        error: `Failed to update competition: ${updateError.message}`
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Insert into competition_winners table for historical record
    const { error: insertError } = await supabase
      .from('competition_winners')
      .insert({
        competitionid: competition_id,
        Winner: winnerAddress,
        ticket_number: winningTicketNumber,
        user_id: winnerUserId,
        vrf_seed: vrfSeed,
        drawn_at: new Date().toISOString()
      })

    if (insertError) {
      console.warn('Warning: Could not insert into competition_winners:', insertError.message)
      // Don't fail the whole operation for this
    }

    console.log('🎉 Winner selection completed!')

    const response = {
      ok: true,
      competition_id,
      winning_ticket_number: winningTicketNumber,
      winner_address: winnerAddress,
      winner_user_id: winnerUserId,
      vrf_seed: vrfSeed,
      tickets_sold: ticketsSold,
      timestamp: new Date().toISOString(),
      verification: {
        method: 'keccak256',
        input: `SELECT-WINNER-${vrfSeed}-${competition_id}`,
        message: 'Anyone can verify this result by computing keccak256 of the input and taking modulo of tickets_sold'
      },
      message: winnerAddress
        ? `Winner selected: ticket #${winningTicketNumber} owned by ${winnerAddress}`
        : `Winning ticket #${winningTicketNumber} selected (owner lookup pending)`
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error drawing winner:', error)
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
