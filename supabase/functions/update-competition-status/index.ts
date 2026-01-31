import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, Cache-Control, Pragma, Expires",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("[Update Competition Status] Starting check for expired competitions...");

    // Get all competitions that have passed their end date and are NOT in terminal states
    // This catches: active, drawing, and draft competitions that should have been processed
    // Ensures NO expired competitions slip through regardless of current status
    const { data: expiredCompetitions, error: fetchError } = await supabase
      .from("competitions")
      .select("*")
      .in("status", ["active", "drawing", "draft"])
      .not("end_date", "is", null)
      .lt("end_date", new Date().toISOString());

    if (fetchError) {
      console.error("[Update Competition Status] Error fetching competitions:", fetchError);
      throw fetchError;
    }

    if (!expiredCompetitions || expiredCompetitions.length === 0) {
      console.log("[Update Competition Status] No expired competitions found");
      return new Response(
        JSON.stringify({
          success: true,
          message: "No expired competitions to process",
          processedCount: 0,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    console.log(`[Update Competition Status] Found ${expiredCompetitions.length} expired competition(s)`);

    const results = [];

    for (const competition of expiredCompetitions) {
      try {
        console.log(`[Update Competition Status] Processing competition: ${competition.title} (${competition.id})`);

        // Update competition status to completed
        const { error: updateError } = await supabase
          .from("competitions")
          .update({
            status: "completed",
            competitionended: 1,
            draw_date: new Date().toISOString(),
          })
          .eq("id", competition.id);

        if (updateError) {
          console.error(`[Update Competition Status] Error updating competition ${competition.id}:`, updateError);
          results.push({
            competitionId: competition.id,
            success: false,
            error: updateError.message,
          });
          continue;
        }

        // For instant win competitions, no winner selection needed
        // Winners are already determined when tickets are purchased
        if (competition.is_instant_win) {
          console.log(`[Update Competition Status] Instant win competition ${competition.id} marked as completed`);
          results.push({
            competitionId: competition.id,
            competitionTitle: competition.title,
            isInstantWin: true,
            success: true,
          });
          continue;
        }

        // For standard competitions, check if we need to select a winner
        const { data: existingWinner } = await supabase
          .from("winners")
          .select("*")
          .eq("competition_id", competition.id)
          .maybeSingle();

        if (existingWinner) {
          console.log(`[Update Competition Status] Winner already exists for competition ${competition.id}`);
          results.push({
            competitionId: competition.id,
            competitionTitle: competition.title,
            success: true,
            hasExistingWinner: true,
          });
          continue;
        }

        // Get competition entries
        const { data: entries, error: entriesError } = await supabase
          .from("joincompetition")
          .select("*")
          .eq("competitionid", competition.uid || competition.id);

        if (entriesError) {
          console.error(`[Update Competition Status] Error fetching entries for ${competition.id}:`, entriesError);
          results.push({
            competitionId: competition.id,
            success: false,
            error: entriesError.message,
          });
          continue;
        }

        if (!entries || entries.length === 0) {
          console.log(`[Update Competition Status] No entries found for competition ${competition.id}`);
          results.push({
            competitionId: competition.id,
            competitionTitle: competition.title,
            success: true,
            noEntries: true,
          });
          continue;
        }

        // Select a winner
        const allTicketNumbers: number[] = [];
        const ticketToEntryMap = new Map<number, any>();

        for (const entry of entries) {
          if (entry.ticketnumbers) {
            const ticketNumbers = entry.ticketnumbers
              .split(",")
              .map((t: string) => parseInt(t.trim()))
              .filter((t: number) => !isNaN(t));

            ticketNumbers.forEach((ticketNum: number) => {
              allTicketNumbers.push(ticketNum);
              ticketToEntryMap.set(ticketNum, entry);
            });
          }
        }

        if (allTicketNumbers.length === 0) {
          console.log(`[Update Competition Status] No valid tickets for competition ${competition.id}`);
          results.push({
            competitionId: competition.id,
            competitionTitle: competition.title,
            success: true,
            noValidTickets: true,
          });
          continue;
        }

        // Use VRF pre-generated numbers to select winner
        try {
          const vrfResponse = await fetch(
            `${supabaseUrl}/functions/v1/vrf-draw-winner`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseServiceKey}`
              },
              body: JSON.stringify({ competition_id: competition.id })
            }
          );
          
          if (!vrfResponse.ok) {
            const errorText = await vrfResponse.text();
            throw new Error(`VRF HTTP ${vrfResponse.status}: ${errorText}`);
          }
          
          const vrfResult = await vrfResponse.json();
          console.log(`[Update Competition Status] VRF draw result for ${competition.id}:`, vrfResult);
          
          if (!vrfResult.ok) {
            throw new Error(vrfResult.error || 'VRF draw failed');
          }
          
          results.push({
            competitionId: competition.id,
            competitionTitle: competition.title,
            winnerId: vrfResult.winner_user_id,
            winningTicket: vrfResult.winning_ticket_number,
            success: true,
            vrfVerified: true
          });
        } catch (vrfErr) {
          console.error(`[Update Competition Status] VRF draw failed for ${competition.id}:`, vrfErr);
          results.push({
            competitionId: competition.id,
            success: false,
            error: (vrfErr as Error).message,
          });
        }

      } catch (error) {
        console.error(`[Update Competition Status] Error processing competition ${competition.id}:`, error);
        results.push({
          competitionId: competition.id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${expiredCompetitions.length} expired competition(s)`,
        processedCount: expiredCompetitions.length,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );

  } catch (error) {
    console.error("[Update Competition Status] Fatal error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
