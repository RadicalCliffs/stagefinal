import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid, isWalletAddress, normalizeWalletAddress } from "../_shared/userId.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Check if user is an admin.
 * Supports wallet addresses, canonical prize:pid:, and legacy Privy DIDs.
 */
async function isAdmin(supabase: SupabaseClient, userIdentifier: string | null | undefined): Promise<boolean> {
  if (!userIdentifier) return false;

  // Convert to canonical format
  const canonicalId = toPrizePid(userIdentifier);

  // Optional allowlist for staging/provisioning: CSV of wallet addresses or Privy IDs
  const allowlist = (Deno.env.get("ADMIN_ALLOWLIST") || "").split(",").map(s => s.trim()).filter(Boolean);
  if (allowlist.length > 0 && allowlist.includes(userIdentifier)) return true;

  // Direct match against admin_users.id as a backward-compatible fallback
  const { data: adminById } = await supabase
    .from("admin_users")
    .select("id, is_active")
    .eq("id", userIdentifier)
    .maybeSingle();

  if (adminById && adminById.is_active !== false) return true;

  // Resolve user from canonical_users using canonical ID
  const { data: puc } = await supabase
    .from("canonical_users")
    .select("email, is_admin")
    .eq("canonical_user_id", canonicalId)
    .maybeSingle();

  // Check is_admin flag on canonical_users (if present in schema)
  if (puc && (puc as any).is_admin === true) return true;

  // Try to match admin by email
  const email = puc?.email;
  if (email) {
    const { data: adminRow } = await supabase
      .from("admin_users")
      .select("id, is_active")
      .eq("email", email)
      .maybeSingle();

    if (adminRow?.is_active !== false) {
      if (adminRow) return true;
    }
  }

  return false;
}

/**
 * Select Competition Winners Function
 *
 * Securely selects winners for a competition with:
 * - Validation that no winner already exists
 * - Verification that selected user has valid tickets
 * - Atomic winner selection to prevent race conditions
 * - Admin authorization checks
 */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase configuration missing");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const { competitionId, privyUserId, forceSelection } = body;

    if (!competitionId) {
      return new Response(
        JSON.stringify({ success: false, error: "competitionId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only require admin for manual/force selections
    if (forceSelection && privyUserId) {
      const admin = await isAdmin(supabase, privyUserId);
      if (!admin) {
        return new Response(
          JSON.stringify({ success: false, error: "Unauthorized - admin access required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // STEP 1: Validate competition exists and is in correct state
    const { data: competition, error: compError } = await supabase
      .from("competitions")
      .select("id, uid, status, title, is_instant_win, total_tickets")
      .eq("id", competitionId)
      .maybeSingle();

    if (compError || !competition) {
      return new Response(
        JSON.stringify({ success: false, error: "Competition not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if competition is instant win (winners determined at purchase)
    if (competition.is_instant_win) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "This is an instant win competition - winners are determined at purchase time"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // STEP 2: Validate no winner already exists
    const existingWinner = await validateNoExistingWinner(supabase, competitionId);
    if (existingWinner) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Winner already selected for this competition",
          existingWinner
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // STEP 3: Get all entries for this competition
    // Use RPC to get entries with both UUID and legacy uid
    const { data: entriesFromRpc, error: rpcError } = await supabase
      .rpc('get_joincompetition_entries_for_competition', {
        p_competition_id: competitionId
      });

    let entries = entriesFromRpc;
    if (rpcError || !entriesFromRpc) {
      console.warn('[select-competition-winners] RPC get entries failed, using fallback:', rpcError?.message);
      const { data: fallbackEntries, error: entriesError } = await supabase
        .from("joincompetition")
        .select("*")
        .eq("competitionid", competitionId);

      if (entriesError) {
        throw new Error(`Failed to fetch entries: ${entriesError.message}`);
      }
      entries = fallbackEntries;
    }

    if (!entries || entries.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No entries found for this competition"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // STEP 4: Build ticket pool from all entries
    const allTicketNumbers: number[] = [];
    const ticketToEntry = new Map<number, any>();

    for (const entry of entries) {
      if (entry.ticketnumbers) {
        const ticketNumbers = entry.ticketnumbers
          .split(",")
          .map((t: string) => parseInt(t.trim()))
          .filter((t: number) => !isNaN(t));

        ticketNumbers.forEach((ticketNum: number) => {
          allTicketNumbers.push(ticketNum);
          ticketToEntry.set(ticketNum, entry);
        });
      }
    }

    if (allTicketNumbers.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No valid tickets found in entries"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // STEP 5: Use VRF pre-generated numbers to select winner
    try {
      const vrfResponse = await fetch(
        `${supabaseUrl}/functions/v1/vrf-draw-winner`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceRoleKey}`
          },
          body: JSON.stringify({ competition_id: competitionId })
        }
      );
      
      if (!vrfResponse.ok) {
        const errorText = await vrfResponse.text();
        throw new Error(`VRF HTTP ${vrfResponse.status}: ${errorText}`);
      }
      
      const vrfResult = await vrfResponse.json();
      
      if (!vrfResult.ok) {
        throw new Error(vrfResult.error || 'VRF draw failed');
      }

      // Get username from canonical_users if available
      let username = "Winner";
      if (vrfResult.winner_user_id) {
        const { data: userData } = await supabase
          .from("canonical_users")
          .select("username")
          .eq("canonical_user_id", vrfResult.winner_user_id)
          .maybeSingle();
        username = userData?.username || "Winner";
      }

      return new Response(
        JSON.stringify({
          success: true,
          winner: {
            userId: vrfResult.winner_user_id,
            username: username,
            ticketNumber: vrfResult.winning_ticket_number,
            walletAddress: vrfResult.winner_address
          },
          competition: {
            id: competitionId,
            title: competition.title,
            totalTickets: allTicketNumbers.length,
            totalEntries: entries.length
          },
          message: vrfResult.message || `Winner selected: ticket #${vrfResult.winning_ticket_number}`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (vrfErr) {
      throw new Error(`VRF draw winner failed: ${(vrfErr as Error).message}`);
    }

  } catch (error) {
    console.error("select-competition-winners error:", error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message || "Failed to select winner" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Validate that no winner already exists for this competition
 */
async function validateNoExistingWinner(supabase: any, competitionId: string) {
  const { data: existingWinners, error } = await supabase
    .from("winners")
    .select("id, user_id, ticket_number, username")
    .eq("competition_id", competitionId);

  if (error) {
    console.error("Error checking existing winners:", error);
  }

  if (existingWinners && existingWinners.length > 0) {
    return existingWinners[0];
  }

  return null;
}

/**
 * Verify that the proposed winner has a valid ticket for this competition
 */
async function validateWinnerHasTicket(
  supabase: any,
  competitionId: string,
  userId: string
): Promise<number | null> {
  // Convert to canonical format
  const canonicalUserId = toPrizePid(userId);
  
  const { data: entry, error } = await supabase
    .from("joincompetition")
    .select("ticketnumbers")
    .eq("competitionid", competitionId)
    .eq("userid", canonicalUserId)
    .maybeSingle();

  if (error || !entry || !entry.ticketnumbers) {
    return null;
  }

  // Parse ticket numbers and return first one
  const ticketNumbers = entry.ticketnumbers
    .split(",")
    .map((t: string) => parseInt(t.trim()))
    .filter((t: number) => !isNaN(t));

  return ticketNumbers.length > 0 ? ticketNumbers[0] : null;
}

/**
 * Select a winning ticket using cryptographically secure random selection
 */
function selectWinningTicket(ticketNumbers: number[]): number {
  if (ticketNumbers.length === 0) {
    throw new Error("No tickets to select from");
  }

  // Use crypto.getRandomValues for cryptographically secure randomness
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  const randomIndex = array[0] % ticketNumbers.length;

  return ticketNumbers[randomIndex];
}
