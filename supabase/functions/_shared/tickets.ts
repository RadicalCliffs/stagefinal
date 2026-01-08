import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface AssignTicketsParams {
  supabase: SupabaseClient;
  /** User identifier - wallet address (0x...) or legacy Privy DID */
  userIdentifier: string;
  /** @deprecated Use userIdentifier instead */
  privyUserId?: string;
  competitionId: string; // uuid as string
  orderId?: string | null; // uuid as string or null
  ticketCount: number;
  preferredTicketNumbers?: number[]; // when user pre-selected tickets (e.g., via order_tickets)
}

export interface AssignTicketsResult {
  ticketNumbers: number[]; // final assigned ticket numbers (unique)
}

// Utility: pick N unique random items from a Set converted to array
function pickRandomUnique<T>(arr: T[], count: number): T[] {
  const result: T[] = [];
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  for (let i = 0; i < count && i < copy.length; i++) {
    result.push(copy[i]);
  }
  return result;
}

export async function assignTickets(params: AssignTicketsParams): Promise<AssignTicketsResult> {
  const { supabase, competitionId, orderId, ticketCount, preferredTicketNumbers } = params;
  // Support both new userIdentifier and legacy privyUserId parameters
  const userIdentifier = params.userIdentifier || params.privyUserId;

  if (!userIdentifier) throw new Error("assignTickets: userIdentifier (wallet address or privy_user_id) is required");
  if (!competitionId) throw new Error("assignTickets: competitionId is required");
  if (!Number.isFinite(ticketCount) || ticketCount <= 0) throw new Error("assignTickets: ticketCount must be > 0");

  // 1) If orderId is provided and tickets already exist for this order, return them (idempotency)
  if (orderId) {
    const { data: existingOrderTickets, error: existingOrderTicketsError } = await supabase
      .from("tickets")
      .select("ticket_number")
      .eq("order_id", orderId);

    if (existingOrderTicketsError) {
      console.error("assignTickets: error reading existing order tickets", existingOrderTicketsError);
    } else if (existingOrderTickets && existingOrderTickets.length > 0) {
      return { ticketNumbers: existingOrderTickets.map((t: any) => Number(t.ticket_number)) };
    }
  }

  // 2) Determine competition capacity and status
  const { data: competition, error: competitionError } = await supabase
    .from("competitions")
    .select("total_tickets, status")
    .eq("id", competitionId)
    .maybeSingle();

  if (competitionError) {
    console.warn("assignTickets: unable to read competition", competitionError);
    throw new Error("assignTickets: competition not found or error reading competition");
  }

  // Check if competition is still active
  if (competition?.status && competition.status !== "active") {
    throw new Error(`assignTickets: competition is not active (status: ${competition.status})`);
  }

  const maxTickets = Number(competition?.total_tickets) || 0;
  if (maxTickets === 0) {
    throw new Error("assignTickets: competition has no tickets configured");
  }

  // 3) Load used ticket numbers for the competition
  const { data: usedTickets, error: usedError } = await supabase
    .from("tickets")
    .select("ticket_number")
    .eq("competition_id", competitionId);

  if (usedError) {
    console.error("assignTickets: error reading used tickets", usedError);
    throw usedError;
  }

  const usedSet = new Set<number>((usedTickets || []).map((t: any) => Number(t.ticket_number)));

  // 4) Calculate available tickets and check for sold-out condition
  const availableCount = maxTickets - usedSet.size;
  if (availableCount <= 0) {
    throw new Error("assignTickets: competition is sold out - no tickets available");
  }

  // Check if we can fulfill the request
  if (ticketCount > availableCount) {
    throw new Error(`assignTickets: cannot allocate ${ticketCount} tickets, only ${availableCount} available`);
  }

  // 5) If preferredTicketNumbers are provided, honor them if available
  let finalTicketNumbers: number[] = [];
  const preferred: number[] = Array.isArray(preferredTicketNumbers)
    ? preferredTicketNumbers.map(n => Number(n)).filter(n => Number.isFinite(n) && n >= 1 && n <= maxTickets)
    : [];

  for (const n of preferred) {
    if (!usedSet.has(n)) {
      finalTicketNumbers.push(n);
      usedSet.add(n); // reserve it
      if (finalTicketNumbers.length >= ticketCount) break;
    }
  }

  // 6) If still need more, allocate from remaining pool
  const remainingCount = ticketCount - finalTicketNumbers.length;
  if (remainingCount > 0) {
    // Build available pool - only scan up to maxTickets
    const available: number[] = [];
    for (let n = 1; n <= maxTickets; n++) {
      if (!usedSet.has(n)) available.push(n);
      // Early exit optimization: once we have enough candidates, stop scanning
      if (available.length >= remainingCount * 5) break;
    }

    if (available.length < remainingCount) {
      throw new Error(`assignTickets: not enough available tickets - need ${remainingCount}, found ${available.length}`);
    }

    const picked = pickRandomUnique(available, remainingCount);
    finalTicketNumbers.push(...picked);
  }

  // 7) Insert into tickets table with retry logic for race conditions
  // This handles the case where another transaction claims a ticket between our check and insert
  const maxRetries = 3;
  let successfullyInserted: number[] = [];
  let remainingToInsert = [...finalTicketNumbers];

  for (let attempt = 0; attempt < maxRetries && remainingToInsert.length > 0; attempt++) {
    const rows = remainingToInsert.map(num => ({
      competition_id: competitionId,
      order_id: orderId ?? null,
      ticket_number: num,
      user_id: userIdentifier, // Stores wallet address for Base auth or DID for Privy
    }));

    // Try inserting all remaining tickets
    const { error: insertError } = await supabase.from("tickets").insert(rows);

    if (!insertError) {
      // All inserts succeeded
      successfullyInserted.push(...remainingToInsert);
      remainingToInsert = [];
      break;
    }

    // Check if it's a unique constraint violation (race condition)
    const isConflictError = insertError.code === '23505' ||
      insertError.message?.includes('unique') ||
      insertError.message?.includes('duplicate');

    if (!isConflictError) {
      // Not a conflict error, throw immediately
      console.error("assignTickets: error inserting tickets", insertError);
      throw insertError;
    }

    console.warn(`assignTickets: conflict on attempt ${attempt + 1}, retrying with fresh ticket selection`);

    // Race condition: some tickets were taken. Re-fetch available tickets and try again
    const { data: currentUsedTickets, error: refetchError } = await supabase
      .from("tickets")
      .select("ticket_number")
      .eq("competition_id", competitionId);

    if (refetchError) {
      console.error("assignTickets: error re-fetching used tickets", refetchError);
      throw refetchError;
    }

    const currentUsedSet = new Set<number>((currentUsedTickets || []).map((t: any) => Number(t.ticket_number)));

    // Check if competition is now sold out after the race
    const currentAvailable = maxTickets - currentUsedSet.size;
    if (currentAvailable < remainingToInsert.length) {
      throw new Error(`assignTickets: competition became sold out during allocation - only ${currentAvailable} tickets remain`);
    }

    // Figure out which of our tickets were actually taken vs which we can still try
    const stillAvailable = remainingToInsert.filter(n => !currentUsedSet.has(n));
    const needToReplace = remainingToInsert.length - stillAvailable.length;

    // Find new replacement tickets
    const newAvailable: number[] = [];
    for (let n = 1; n <= maxTickets && newAvailable.length < needToReplace * 5; n++) {
      if (!currentUsedSet.has(n) && !stillAvailable.includes(n)) {
        newAvailable.push(n);
      }
    }

    if (newAvailable.length < needToReplace) {
      throw new Error("assignTickets: not enough available tickets remain after conflict resolution");
    }

    const replacements = pickRandomUnique(newAvailable, needToReplace);
    remainingToInsert = [...stillAvailable, ...replacements];

    // Update finalTicketNumbers with the new selection
    finalTicketNumbers = [...successfullyInserted, ...remainingToInsert];
  }

  if (remainingToInsert.length > 0) {
    throw new Error("assignTickets: failed to insert tickets after multiple retries");
  }

  return { ticketNumbers: finalTicketNumbers };
}
