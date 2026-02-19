// Server-side direct call (redundancy/fallback)
// Do NOT do this in the browser. Do this only in a trusted server (Node/Deno) environment.
// Required params for purchase_tickets_with_balance (exactly 6):
// - p_user_identifier: text
// - p_competition_id: text (UUID string)
// - p_ticket_price: numeric
// - p_ticket_count: integer | null
// - p_ticket_numbers: integer[] | null
// - p_idempotency_key: text | null

// Get project URL from environment variable
const PROJECT_URL = typeof process !== 'undefined'
  ? process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  : typeof Deno !== 'undefined'
    ? Deno.env.get('SUPABASE_URL') || Deno.env.get('VITE_SUPABASE_URL')
    : undefined;

if (!PROJECT_URL) {
  console.warn('SUPABASE_URL not found in environment. serverPurchaseDirect will fail.');
}

// IMPORTANT: ONLY access SERVICE_ROLE_KEY in server environment, NEVER in browser
// Use process.env in Node.js or Deno.env in Deno
const SERVICE_ROLE_KEY = typeof process !== 'undefined' 
  ? process.env.SUPABASE_SERVICE_ROLE_KEY 
  : typeof Deno !== 'undefined'
    ? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    : undefined;

interface ServerPurchaseParams {
  p_user_identifier: string;
  p_competition_id: string;
  p_ticket_price: number;
  p_ticket_count?: number | null;
  p_ticket_numbers?: number[] | null;
  p_idempotency_key?: string | null;
}

export async function serverPurchaseDirect(params: ServerPurchaseParams) {
  if (!PROJECT_URL) {
    throw new Error('SUPABASE_URL is not set in environment. Cannot make direct purchase.');
  }
  
  if (!SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not available. This function must only be called in a server environment.');
  }
  
  const res = await fetch(`${PROJECT_URL}/rest/v1/rpc/purchase_tickets_with_balance`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
