import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { toPrizePid, isPrizePid, normalizeWalletAddress } from "../_shared/userId.ts";
import { buildCorsHeaders, handleCorsOptions } from "../_shared/cors.ts";

/**
 * Purchase Tickets With Bonus Edge Function (Cold-Start Optimized)
 * 
 * This function handles ticket purchases with balance payment.
 */

// ============================================================================
// MAIN LOGIC (loaded after OPTIONS check to help with cold starts)
// ============================================================================

async function processPurchase(req: Request): Promise<Response> {
  const corsHeaders = buildCorsHeaders(req.headers.get('origin'));
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ success: false, error: "Configuration error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "Invalid JSON" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const userId = body.userId as string | null || body.userIdentifier as string | null || body.user_id as string | null || null;
  const walletAddress = body.walletAddress as string | null || null;
  const competitionId = body.competitionId as string | null || body.competition_id as string | null || null;
  const numberOfTickets = Number(body.numberOfTickets ?? body.number_of_tickets ?? body.quantity ?? 0);
  const ticketPrice = Number(body.ticketPrice ?? body.ticket_price ?? body.price ?? 0);
  const selectedTickets = Array.isArray(body.selectedTickets) ? body.selectedTickets : [];
  const reservationId = body.reservationId as string | null || body.reservation_id as string | null || null;

  // Quick validation
  if (!userId && !walletAddress) {
    return new Response(
      JSON.stringify({ success: false, error: "userId or walletAddress required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!competitionId || !numberOfTickets || !ticketPrice) {
    return new Response(
      JSON.stringify({ success: false, error: "Missing required fields" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Resolve user ID
  let resolvedUserId = userId;
  if (!resolvedUserId && walletAddress && /^0x[a-fA-F0-9]{40}$/i.test(walletAddress)) {
    const normalizedWallet = walletAddress.toLowerCase();
    const { data } = await supabase
      .from("canonical_users")
      .select("canonical_user_id")
      .or(`wallet_address.ilike.${normalizedWallet},base_wallet_address.ilike.${normalizedWallet}`)
      .limit(1)
      .maybeSingle();
    resolvedUserId = data?.canonical_user_id || toPrizePid(walletAddress);
  }

  const canonicalUserId = toPrizePid(resolvedUserId || walletAddress || '');

  // Get balance
  const { data: balanceData } = await supabase
    .from("sub_account_balances")
    .select("id, available_balance")
    .eq("currency", "USD")
    .or(`canonical_user_id.eq.${canonicalUserId}`)
    .maybeSingle();

  const userBalance = Number(balanceData?.available_balance || 0);
  const totalCost = numberOfTickets * ticketPrice;

  if (userBalance < totalCost) {
    return new Response(
      JSON.stringify({ success: false, error: `Insufficient balance. Need ${totalCost.toFixed(2)} USDC, have ${userBalance.toFixed(2)} USDC`, errorCode: "insufficient_balance" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Check competition
  const { data: comp } = await supabase
    .from("competitions")
    .select("id, is_instant_win, total_tickets, status")
    .eq("id", competitionId)
    .maybeSingle();

  if (!comp || comp.status !== "active") {
    return new Response(
      JSON.stringify({ success: false, error: "Competition not found or not active" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get unavailable tickets
  const { data: unavailableData } = await supabase
    .rpc('get_unavailable_tickets', { p_competition_id: competitionId });

  const unavailableSet = new Set<number>((unavailableData as number[] | null) || []);
  const availableNumbers: number[] = [];
  for (let i = 1; i <= comp.total_tickets; i++) {
    if (!unavailableSet.has(i)) availableNumbers.push(i);
  }

  // Handle reservation if provided
  let reservedNumbers: number[] | null = null;
  if (reservationId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reservationId)) {
    const { data: reservation } = await supabase
      .from("pending_tickets")
      .select("ticket_numbers")
      .eq("id", reservationId)
      .eq("user_id", canonicalUserId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (reservation?.ticket_numbers) {
      reservedNumbers = reservation.ticket_numbers.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n));
    }
  }

  // Select tickets
  const ticketNumbers = reservedNumbers && reservedNumbers.length > 0
    ? reservedNumbers.slice(0, numberOfTickets)
    : selectedTickets.length > 0
      ? selectedTickets.filter(n => !unavailableSet.has(Number(n)) && Number(n) > 0 && Number(n) <= comp.total_tickets).slice(0, numberOfTickets)
      : availableNumbers.slice(0, numberOfTickets);

  if (ticketNumbers.length < numberOfTickets) {
    return new Response(
      JSON.stringify({ success: false, error: `Only ${ticketNumbers.length} tickets available` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const newBalance = Number((userBalance - totalCost).toFixed(2));

  // Debit balance
  if (balanceData?.id) {
    await supabase
      .from("sub_account_balances")
      .update({ available_balance: newBalance, updated_at: new Date().toISOString() })
      .eq("id", balanceData.id);
  }

  // Create joincompetition entry
  const entryUid = crypto.randomUUID();
  const txRef = `balance_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  await supabase.from("joincompetition").insert({
    uid: entryUid,
    competitionid: competitionId,
    userid: canonicalUserId,
    canonical_user_id: canonicalUserId,
    privy_user_id: canonicalUserId,
    numberoftickets: ticketNumbers.length,
    ticketnumbers: ticketNumbers.join(","),
    amountspent: totalCost,
    chain: "balance",
    transactionhash: txRef,
    purchasedate: new Date().toISOString(),
    status: "sold",
    created_at: new Date().toISOString(),
  });

  // Create transaction record
  const transactionId = crypto.randomUUID();
  await supabase.from("user_transactions").insert({
    id: transactionId,
    user_id: canonicalUserId,
    canonical_user_id: canonicalUserId,
    type: 'entry',
    amount: totalCost,
    currency: 'USD',
    balance_before: userBalance,
    balance_after: newBalance,
    competition_id: competitionId,
    description: `Purchase ${ticketNumbers.length} tickets`,
    status: 'completed',
    payment_status: 'completed',
    payment_provider: 'balance',
    ticket_count: ticketNumbers.length,
    tx_id: txRef,
    metadata: { ticket_numbers: ticketNumbers },
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  });

  // Finalize reservation if used
  if (reservationId && reservedNumbers && reservedNumbers.length > 0) {
    await supabase
      .from("pending_tickets")
      .update({ status: "confirmed", transaction_hash: txRef, payment_provider: "balance", confirmed_at: new Date().toISOString() })
      .eq("id", reservationId);
  }

  return new Response(
    JSON.stringify({
      status: 'ok',
      success: true,
      competition_id: competitionId,
      tickets: ticketNumbers.map(num => ({ ticket_number: num })),
      entry_id: entryUid,
      total_cost: totalCost,
      new_balance: newBalance,
      message: `Successfully purchased ${ticketNumbers.length} tickets!`,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// Main handler with cold-start optimized OPTIONS handling
Deno.serve(async (req: Request) => {
  // Handle preflight immediately - no Supabase client needed
  if (req.method === "OPTIONS") {
    return handleCorsOptions(req);
  }

  // Only POST allowed for actual requests
  if (req.method !== "POST") {
    const corsHeaders = buildCorsHeaders(req.headers.get('origin'));
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    return await processPurchase(req);
  } catch (error) {
    console.error("Purchase error:", error);
    const corsHeaders = buildCorsHeaders(req.headers.get('origin'));
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
