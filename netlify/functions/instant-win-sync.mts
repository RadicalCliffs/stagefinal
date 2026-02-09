import type { Context, Config } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toPrizePid, extractPrizePid, isWalletAddress as isValidWalletAddress } from "./_shared/userId.mts";

/**
 * Instant Win Sync Function - Server-side atomic instant win operations
 *
 * This function handles instant win prize synchronization between blockchain
 * contract events and the database. It uses atomic operations to prevent
 * race conditions (TOCTOU bugs) that occur when checking and then inserting.
 *
 * Routes:
 * - POST /api/instant-win-sync/claim - Atomically claim an instant win prize
 * - POST /api/instant-win-sync/sync - Sync contract event to database
 * - GET /api/instant-win-sync/:competitionId - Get instant win status for competition
 */

// Response helpers
function jsonResponse(data: object, status: number = 200, origin?: string | null): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "content-type, authorization";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function errorResponse(message: string, status: number = 400, origin?: string | null): Response {
  return jsonResponse({ error: message, ok: false }, status, origin);
}

// UUID validation
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// Wallet address validation
function isWalletAddress(str: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(str);
}

// Get Supabase client with service role
function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = Netlify.env.get("VITE_SUPABASE_URL") || Netlify.env.get("SUPABASE_URL");
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Verify wallet token authentication
async function verifyWalletToken(
  token: string,
  supabase: SupabaseClient
): Promise<{ userId: string; profileId: string; walletAddress: string } | null> {
  if (!token.startsWith("wallet:")) return null;

  const walletAddress = token.replace("wallet:", "").trim().toLowerCase();
  if (!isWalletAddress(walletAddress)) return null;

  // Look up user by wallet address
  const { data: user, error } = await supabase
    .from("canonical_users")
    .select("id, privy_user_id, wallet_address, base_wallet_address")
    .or(`wallet_address.ilike.${walletAddress},base_wallet_address.ilike.${walletAddress}`)
    .maybeSingle();

  if (error || !user) return null;

  return {
    userId: user.privy_user_id || walletAddress,
    profileId: user.id,
    walletAddress,
  };
}

// Get authenticated user from request
async function getAuthenticatedUser(
  request: Request,
  supabase: SupabaseClient
): Promise<{ userId: string; profileId: string; walletAddress: string } | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token || token.length < 10) return null;

  // Try wallet token first
  return await verifyWalletToken(token, supabase);
}

interface ClaimRequest {
  competitionId: string;
  ticketNumber: number;
  prizeTier?: string;
  prizeValue?: number;
}

interface SyncRequest {
  competitionId: string;
  ticketNumber: number;
  buyerAddress: string;
  tierId?: string;
  transactionHash?: string;
}

/**
 * Create a winner notification for instant win prizes
 */
async function createInstantWinNotification(
  supabase: SupabaseClient,
  competitionId: string,
  ticketNumber: number,
  buyerAddress: string,
  prizeTier: string
): Promise<void> {
  try {
    // Look up user by wallet address to get their profile ID
    const { data: user } = await supabase
      .from("canonical_users")
      .select("id")
      .or(`wallet_address.ilike.${buyerAddress},base_wallet_address.ilike.${buyerAddress}`)
      .maybeSingle();

    if (!user?.id) {
      console.log(`[Instant Win] No user profile found for wallet ${buyerAddress}, skipping notification`);
      return;
    }

    // Get competition details for the notification message
    const { data: competition } = await supabase
      .from("competitions")
      .select("title, prize_value")
      .eq("id", competitionId)
      .maybeSingle();

    const competitionTitle = competition?.title || "an instant win competition";
    const prizeInfo = competition?.prize_value ? `£${competition.prize_value}` : prizeTier;

    const { error } = await supabase.from("user_notifications").insert({
      user_id: user.id,
      type: "win",
      title: "🎉 Instant Win! You Won!",
      message: `Congratulations! Your ticket #${ticketNumber} in ${competitionTitle} is an instant winner! You won: ${prizeInfo}. Check your entries for more details.`,
      competition_id: competitionId,
      prize_info: prizeInfo,
      read: false,
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error("[Instant Win] Error creating notification:", error);
    } else {
      console.log(`[Instant Win] Notification created for user ${user.id}`);
    }
  } catch (err) {
    console.error("[Instant Win] Error in createInstantWinNotification:", err);
  }
}

// Atomically claim an instant win prize
// Uses upsert to prevent race conditions
async function handleClaimPrize(
  body: ClaimRequest,
  walletAddress: string,
  userId: string,
  supabase: SupabaseClient,
  origin?: string | null
): Promise<Response> {
  const { competitionId, ticketNumber, prizeTier, prizeValue } = body;

  if (!competitionId || !isValidUUID(competitionId)) {
    return errorResponse("Invalid competition ID", 400, origin);
  }

  if (typeof ticketNumber !== "number" || ticketNumber < 1) {
    return errorResponse("Invalid ticket number", 400, origin);
  }

  try {
    // Convert userId to canonical format for consistent storage
    const canonicalUserId = userId ? toPrizePid(userId) : null;

    // Use an atomic upsert to prevent TOCTOU race conditions
    // The unique constraint on (competitionId, winningTicket) ensures only one winner
    const { data, error } = await supabase
      .from("Prize_Instantprizes")
      .upsert(
        {
          competitionId,
          winningTicket: ticketNumber,
          winningWalletAddress: walletAddress,
          winningUserId: canonicalUserId,
          prize: prizeTier || "Instant Win",
          prizeValue: prizeValue || null,
          wonAt: new Date().toISOString(),
          dataSource: "claim",
        },
        {
          onConflict: "competitionId,winningTicket",
          ignoreDuplicates: false, // Update if exists
        }
      )
      .select()
      .single();

    if (error) {
      // Check if it's a conflict error (someone else claimed it)
      if (error.code === "23505") {
        return errorResponse("This prize has already been claimed", 409, origin);
      }
      console.error("Error claiming prize:", error);
      return errorResponse(`Failed to claim prize: ${error.message}`, 500, origin);
    }

    // Verify the claim was successful (wallet address matches)
    if (data.winningWalletAddress?.toLowerCase() !== walletAddress.toLowerCase()) {
      return errorResponse("This prize was claimed by another user", 409, origin);
    }

    console.log(`[Instant Win] Prize claimed: competition=${competitionId}, ticket=${ticketNumber}, winner=${walletAddress}`);

    // Send server-side notification for the claim
    await createInstantWinNotification(supabase, competitionId, ticketNumber, walletAddress, prizeTier || "Instant Win");

    return jsonResponse({
      ok: true,
      claimed: true,
      prize: {
        uid: data.UID,
        competitionId: data.competitionId,
        ticketNumber: data.winningTicket,
        prizeTier: data.prize,
        prizeValue: data.prizeValue,
        claimedAt: data.wonAt,
      },
    }, 200, origin);
  } catch (err) {
    console.error("Claim prize error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Failed to claim prize",
      500,
      origin
    );
  }
}

// Sync a contract event to the database atomically
async function handleSyncContractEvent(
  body: SyncRequest,
  supabase: SupabaseClient,
  origin?: string | null
): Promise<Response> {
  const { competitionId, ticketNumber, buyerAddress, tierId, transactionHash } = body;

  if (!competitionId || !isValidUUID(competitionId)) {
    return errorResponse("Invalid competition ID", 400, origin);
  }

  if (typeof ticketNumber !== "number" || ticketNumber < 1) {
    return errorResponse("Invalid ticket number", 400, origin);
  }

  if (!buyerAddress || !isWalletAddress(buyerAddress)) {
    return errorResponse("Invalid buyer address", 400, origin);
  }

  try {
    // Convert buyer address to canonical format
    const canonicalBuyerId = toPrizePid(buyerAddress);

    // Use atomic upsert - if record exists, update it; if not, create it
    // This prevents the TOCTOU bug in the original code
    const { data, error } = await supabase
      .from("Prize_Instantprizes")
      .upsert(
        {
          competitionId,
          winningTicket: ticketNumber,
          winningWalletAddress: buyerAddress.toLowerCase(),
          winningUserId: canonicalBuyerId,
          prize: tierId || "Instant Win",
          wonAt: new Date().toISOString(),
          dataSource: "contract",
          transactionHash: transactionHash || null,
        },
        {
          onConflict: "competitionId,winningTicket",
          ignoreDuplicates: false,
        }
      )
      .select()
      .single();

    if (error) {
      console.error("Error syncing contract event:", error);
      return errorResponse(`Failed to sync: ${error.message}`, 500, origin);
    }

    console.log(`[Instant Win] Contract event synced: competition=${competitionId}, ticket=${ticketNumber}, buyer=${buyerAddress}`);

    // Send server-side notification for the instant win
    await createInstantWinNotification(supabase, competitionId, ticketNumber, buyerAddress, tierId || "Instant Win");

    return jsonResponse({
      ok: true,
      synced: true,
      prize: {
        uid: data.UID,
        competitionId: data.competitionId,
        ticketNumber: data.winningTicket,
        winnerAddress: data.winningWalletAddress,
        prizeTier: data.prize,
        dataSource: data.dataSource,
      },
    }, 200, origin);
  } catch (err) {
    console.error("Sync contract event error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Failed to sync contract event",
      500,
      origin
    );
  }
}

// Get instant win status for a competition
async function handleGetStatus(
  competitionId: string,
  userAddress: string | null,
  supabase: SupabaseClient,
  origin?: string | null
): Promise<Response> {
  if (!isValidUUID(competitionId)) {
    return errorResponse("Invalid competition ID", 400, origin);
  }

  try {
    // Get all instant win prizes for this competition
    const { data: prizes, error } = await supabase
      .from("Prize_Instantprizes")
      .select("UID, winningTicket, winningWalletAddress, prize, prizeValue, wonAt, dataSource")
      .eq("competitionId", competitionId);

    if (error) {
      console.error("Error fetching instant win status:", error);
      return errorResponse(`Failed to fetch status: ${error.message}`, 500, origin);
    }

    // Categorize prizes
    const claimedPrizes = prizes?.filter((p) => p.winningWalletAddress) || [];
    const userWins = userAddress
      ? claimedPrizes.filter(
          (p) => p.winningWalletAddress?.toLowerCase() === userAddress.toLowerCase()
        )
      : [];

    // Count by data source
    const contractWins = claimedPrizes.filter((p) => p.dataSource === "contract").length;
    const databaseWins = claimedPrizes.filter((p) => p.dataSource === "database" || !p.dataSource).length;
    const claimWins = claimedPrizes.filter((p) => p.dataSource === "claim").length;

    return jsonResponse({
      ok: true,
      competitionId,
      stats: {
        totalPrizes: prizes?.length || 0,
        claimedPrizes: claimedPrizes.length,
        unclaimedPrizes: (prizes?.length || 0) - claimedPrizes.length,
        userWinCount: userWins.length,
        bySource: {
          contract: contractWins,
          database: databaseWins,
          claim: claimWins,
        },
      },
      userWins: userWins.map((p) => ({
        ticketNumber: p.winningTicket,
        prizeTier: p.prize,
        prizeValue: p.prizeValue,
        claimedAt: p.wonAt,
      })),
      allWinningTickets: claimedPrizes.map((p) => p.winningTicket),
    }, 200, origin);
  } catch (err) {
    console.error("Get instant win status error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Failed to get status",
      500,
      origin
    );
  }
}

// Main handler
export default async (req: Request, context: Context): Promise<Response> => {
  const origin = req.headers.get("origin");

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Headers": "content-type, authorization",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      },
    });
  }

  try {
    const supabase = getSupabaseClient();

    // Parse route
    const url = new URL(req.url);
    const pathParts = url.pathname.replace("/api/instant-win-sync", "").split("/").filter(Boolean);

    // POST routes
    if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = await req.json();
      } catch {
        return errorResponse("Invalid JSON body", 400, origin);
      }

      if (pathParts[0] === "claim") {
        // Claim requires authentication
        const authUser = await getAuthenticatedUser(req, supabase);
        if (!authUser) {
          return errorResponse("Unauthorized - valid Bearer token required", 401, origin);
        }

        return handleClaimPrize(
          body as ClaimRequest,
          authUser.walletAddress,
          authUser.userId,
          supabase,
          origin
        );
      }

      if (pathParts[0] === "sync") {
        // Sync can be called by contract event handlers (server-to-server)
        // Optionally require an API key for security
        const apiKey = req.headers.get("X-API-Key");
        const expectedKey = Netlify.env.get("INSTANT_WIN_SYNC_API_KEY");

        if (expectedKey && apiKey !== expectedKey) {
          return errorResponse("Invalid API key", 401, origin);
        }

        return handleSyncContractEvent(body as SyncRequest, supabase, origin);
      }

      return errorResponse("Unknown route", 404, origin);
    }

    // GET routes
    if (req.method === "GET") {
      const competitionId = pathParts[0];
      if (!competitionId) {
        return errorResponse("Competition ID required", 400, origin);
      }

      // Optional authentication to get user-specific wins
      const authUser = await getAuthenticatedUser(req, supabase);

      return handleGetStatus(
        competitionId,
        authUser?.walletAddress || null,
        supabase,
        origin
      );
    }

    return errorResponse("Method not allowed", 405, origin);
  } catch (err) {
    console.error("Instant win sync error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500,
      origin
    );
  }
};

export const config: Config = {
  path: "/api/instant-win-sync/*",
};
