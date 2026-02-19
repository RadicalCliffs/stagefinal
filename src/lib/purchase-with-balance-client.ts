// Browser call using anon key or user token to authenticate the Edge Function request itself.
// The function will use the service role key to hit PostgREST.

import type { SupabaseClient } from '@supabase/supabase-js';

const EDGE_URL = 'https://mthwfldcjvpxjtmrqkqm.supabase.co/functions/v1/purchase-with-balance';

interface PurchaseWithBalanceParams {
  p_user_identifier: string;
  p_competition_id: string; // UUID string
  p_ticket_price: number;
  p_ticket_count?: number | null; // number | null
  p_ticket_numbers?: number[] | null; // number[] | null
  p_idempotency_key: string; // string (UUID recommended)
  supabaseClient: SupabaseClient; // your created client
}

export async function purchaseWithBalanceViaEdge({
  p_user_identifier,
  p_competition_id,
  p_ticket_price,
  p_ticket_count = null,
  p_ticket_numbers = null,
  p_idempotency_key,
  supabaseClient,
}: PurchaseWithBalanceParams) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const accessToken = session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY;
  const res = await fetch(EDGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`, // user token or anon key
    },
    body: JSON.stringify({
      p_user_identifier,
      p_competition_id,
      p_ticket_price,
      p_ticket_count,
      p_ticket_numbers,
      p_idempotency_key,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Edge failed ${res.status}: ${t}`);
  }
  return res.json();
}
