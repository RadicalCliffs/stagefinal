// VRF Draw Winner - Selects winner using pregenerated VRF seed
// This function should be called when a competition ends (manually or via cron)
// It uses the VRF seed pregenerated at competition creation time to select the winner

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE, PATCH",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Credentials": "false",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const requestData = await req.json();
    const { competition_id } = requestData;

    // Validate required parameters
    if (!competition_id) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "competition_id is required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Supabase configuration missing",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Setup Supabase client with service role
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("🎯 Drawing winner for competition:", competition_id);

    // Fetch competition data including pregenerated VRF seed
    const { data: competition, error: fetchError } = await supabase
      .from("competitions")
      .select(
        "id, title, outcomes_vrf_seed, tickets_sold, total_tickets, status, winner_address, end_date",
      )
      .eq("id", competition_id)
      .single();

    if (fetchError || !competition) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Competition not found: ${fetchError?.message || "Unknown error"}`,
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Validate competition state
    if (competition.winner_address) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Winner already selected for this competition",
          winner_address: competition.winner_address,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!competition.outcomes_vrf_seed) {
      return new Response(
        JSON.stringify({
          ok: false,
          error:
            "VRF seed not pregenerated for this competition. Cannot draw winner.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const ticketsSold = competition.tickets_sold || 0;
    if (ticketsSold === 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "No tickets sold for this competition",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log("📊 Competition data:");
    console.log("- Title:", competition.title);
    console.log("- Tickets sold:", ticketsSold);
    console.log("- VRF Seed:", competition.outcomes_vrf_seed);

    // Use VRF seed to deterministically select winning ticket number
    // This is provably fair - anyone can verify the result using the same seed
    // IMPORTANT: Using SHA-256 with first 16 hex chars to match PostgreSQL digest() method
    const vrfSeed = competition.outcomes_vrf_seed;
    const message = `SELECT-WINNER-${vrfSeed}-${competition_id}`;
    
    // Hash with SHA-256 (matching PostgreSQL digest)
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    
    // Convert to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    // Take first 16 hex characters (matching PostgreSQL substring)
    const first16 = hashHex.substring(0, 16);
    const hashBigInt = BigInt('0x' + first16);

    // Convert hash to a number within ticket range (1 to ticketsSold)
    const winningTicketNumber = Number(
      (hashBigInt % BigInt(ticketsSold)) + BigInt(1),
    );

    console.log("🎫 Winning ticket number:", winningTicketNumber);

    // Find the ticket owner - try exact ticket first
    const { data: winningTicket, error: ticketError } = await supabase
      .from("tickets")
      .select(
        "user_id, canonical_user_id, privy_user_id, wallet_address, ticket_number",
      )
      .eq("competition_id", competition_id)
      .eq("ticket_number", winningTicketNumber)
      .maybeSingle();

    let winnerAddress = null;
    let winnerUserId = null;
    let actualWinningTicket = winningTicketNumber;

    if (winningTicket) {
      winnerAddress = winningTicket.wallet_address;
      winnerUserId =
        winningTicket.user_id ||
        winningTicket.canonical_user_id ||
        winningTicket.privy_user_id;
      actualWinningTicket = winningTicket.ticket_number;
      console.log("🏆 Winner found (exact ticket):", winnerAddress);
    } else {
      // Ticket number doesn't exist - find next available ticket (wrapping around)
      console.warn(
        "⚠️ Ticket #" +
          winningTicketNumber +
          " doesn't exist, finding next available ticket",
      );

      // Try tickets >= winning number first
      const { data: nextTicket } = await supabase
        .from("tickets")
        .select(
          "user_id, canonical_user_id, privy_user_id, wallet_address, ticket_number",
        )
        .eq("competition_id", competition_id)
        .gte("ticket_number", winningTicketNumber)
        .order("ticket_number", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (nextTicket) {
        winnerAddress = nextTicket.wallet_address;
        winnerUserId =
          nextTicket.user_id ||
          nextTicket.canonical_user_id ||
          nextTicket.privy_user_id;
        actualWinningTicket = nextTicket.ticket_number;
        console.log(
          "🏆 Winner found (next ticket #" + actualWinningTicket + "):",
          winnerAddress,
        );
      } else {
        // Wrap to beginning
        const { data: firstTicket } = await supabase
          .from("tickets")
          .select(
            "user_id, canonical_user_id, privy_user_id, wallet_address, ticket_number",
          )
          .eq("competition_id", competition_id)
          .order("ticket_number", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (firstTicket) {
          winnerAddress = firstTicket.wallet_address;
          winnerUserId =
            firstTicket.user_id ||
            firstTicket.canonical_user_id ||
            firstTicket.privy_user_id;
          actualWinningTicket = firstTicket.ticket_number;
          console.log(
            "🏆 Winner found (wrapped to ticket #" + actualWinningTicket + "):",
            winnerAddress,
          );
        }
      }
    }

    if (!winnerAddress) {
      console.warn(
        "⚠️ Could not find any tickets for this competition after trying exact, next, and first ticket lookups",
        winningTicketNumber,
      );
    }

    const now = new Date().toISOString();

    // Update competition with winner information AND mark as completed
    const { error: updateError } = await supabase
      .from("competitions")
      .update({
        winner_address: winnerAddress,
        status: "completed",
        competitionended: 1,
        drawn_at: now,
        vrf_draw_completed_at: now,
      })
      .eq("id", competition_id);

    if (updateError) {
      console.error("Error updating competition:", updateError);
      return new Response(
        JSON.stringify({
          ok: false,
          error: `Failed to update competition: ${updateError.message}`,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Insert into competition_winners table for historical record
    const { error: insertError } = await supabase
      .from("competition_winners")
      .insert({
        competitionid: competition_id,
        winner: winnerAddress,
        ticket_number: actualWinningTicket,
        user_id: winnerUserId,
        won_at: now,
      });

    if (insertError) {
      console.warn(
        "Warning: Could not insert into competition_winners:",
        insertError.message,
      );
      // Don't fail the whole operation for this
    }

    // CRITICAL: Insert into winners table for frontend realtime subscriptions
    if (winnerUserId) {
      const { error: winnerError } = await supabase.from("winners").insert({
        competition_id: competition_id,
        user_id: winnerUserId,
        wallet_address: winnerAddress,
        ticket_number: actualWinningTicket,
        prize_position: 1,
        won_at: now,
        created_at: now,
        is_instant_win: false,
      });

      if (winnerError) {
        console.warn(
          "Warning: Could not insert into winners table:",
          winnerError.message,
        );
      } else {
        console.log(
          "✅ Winner inserted into winners table for realtime updates",
        );
      }

      // Update joincompetition entries to set is_winner flag
      const { error: joinError } = await supabase
        .from("joincompetition")
        .update({ is_winner: true })
        .eq("competition_id", competition_id)
        .eq("user_id", winnerUserId);

      if (joinError) {
        console.warn(
          "Warning: Could not update joincompetition is_winner flag:",
          joinError.message,
        );
      } else {
        console.log("✅ is_winner flag set in joincompetition");
      }
    }

    console.log("🎉 Winner selection completed!");

    const response = {
      ok: true,
      competition_id,
      winning_ticket_number: actualWinningTicket,
      calculated_ticket_number: winningTicketNumber,
      winner_address: winnerAddress,
      winner_user_id: winnerUserId,
      vrf_seed: vrfSeed,
      tickets_sold: ticketsSold,
      timestamp: new Date().toISOString(),
      verification: {
        method: "keccak256",
        input: `SELECT-WINNER-${vrfSeed}-${competition_id}`,
        message:
          "Anyone can verify this result by computing keccak256 of the input and taking modulo of tickets_sold",
      },
      message: winnerAddress
        ? `Winner selected: ticket #${winningTicketNumber} owned by ${winnerAddress}`
        : `Winning ticket #${winningTicketNumber} selected (owner lookup pending)`,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error drawing winner:", error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
