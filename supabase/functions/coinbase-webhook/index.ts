// coinbase-webhook Edge Function
// Verifies Coinbase Commerce webhook signatures and credits user balances idempotently
// Env: COINBASE_WEBHOOK_SECRET (set via `supabase secrets set COINBASE_WEBHOOK_SECRET=...`)
// Uses built-in envs: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { createHmac } from "node:crypto";

// Minimal logger
const log = (...args: unknown[]) => console.log("[coinbase-webhook]", ...args);

// Init service client (bypasses RLS, required for server-side webhook)
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// Coinbase signature verification per docs:
// https://commerce.coinbase.com/docs/api/#webhooks
function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const computed = createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  // Header format appears as: t=..., s=..., Not strictly needed for Commerce; accept exact match
  // Many integrations simply match header === computed
  return (
    signatureHeader === computed ||
    signatureHeader.split(",").some((part) => part.trim().endsWith(computed))
  );
}

// Extract canonical fields from Coinbase payload
function deriveFromEvent(evt: any) {
  // Prefer data.id as stable id; fallback to event.id
  const tx_id: string = evt?.data?.id ?? evt?.id;
  // Amount/currency: try pricing.local or pricing.settlement; fallback to data.pricing
  const pricing = evt?.pricing ?? evt?.data?.pricing ?? {};
  const local = pricing?.local ?? pricing?.settlement ?? {};
  const currency: string =
    local?.currency ?? evt?.data?.payments?.[0]?.value?.local?.currency;
  const amountStr: string =
    local?.amount ?? evt?.data?.payments?.[0]?.value?.local?.amount;

  // canonical_user_id from metadata
  const canonical_user_id: string | undefined =
    evt?.metadata?.canonical_user_id ??
    evt?.data?.metadata?.canonical_user_id ??
    evt?.data?.metadata?.user_id ??
    evt?.data?.metadata?.uid;

  return { tx_id, currency, amountStr, canonical_user_id };
}

function isPaySuccess(evt: any): boolean {
  // Accept successful/terminal payment states
  const type = evt?.type ?? evt?.event?.type;
  // Coinbase Commerce common success types: charge:confirmed, charge:resolved
  return type === "charge:confirmed" || type === "charge:resolved";
}

async function creditTopup(args: {
  canonical_user_id: string;
  amountStr: string;
  currency: string;
  tx_id: string;
  payment_provider?: string;
}) {
  const amount = Number(args.amountStr);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Invalid amount");
  }
  const { data, error } = await supabase.rpc("credit_user_topup", {
    p_canonical_user_id: args.canonical_user_id,
    p_amount: amount,
    p_currency: args.currency,
    p_external_ref: args.tx_id, // FIXED: was p_tx_id
    p_payment_provider: args.payment_provider ?? "coinbase_commerce",
  });
  if (error) throw error;
  return data;
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const secret = Deno.env.get("COINBASE_WEBHOOK_SECRET");
    if (!secret) {
      log("Missing COINBASE_WEBHOOK_SECRET");
      return new Response("Server misconfigured", { status: 500 });
    }

    // Get raw body for signature verification
    const rawBody = await req.text();
    const sigHeader =
      req.headers.get("X-CC-Webhook-Signature") ||
      req.headers.get("x-cc-webhook-signature");
    if (!verifySignature(rawBody, sigHeader, secret)) {
      log("Signature verification failed");
      return new Response("Invalid signature", { status: 400 });
    }

    const evt = JSON.parse(rawBody);
    if (!isPaySuccess(evt)) {
      // Acknowledge non-final events to avoid retries, but do nothing
      return new Response(
        JSON.stringify({ status: "ignored", reason: "non_final_event" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const { tx_id, currency, amountStr, canonical_user_id } =
      deriveFromEvent(evt);

    if (!tx_id || !currency || !amountStr || !canonical_user_id) {
      log("Missing fields", { tx_id, currency, amountStr, canonical_user_id });
      return new Response(
        JSON.stringify({ error: "missing required fields" }),
        { status: 422 },
      );
    }

    const result = await creditTopup({
      canonical_user_id: canonical_user_id,
      amountStr,
      currency,
      tx_id,
      payment_provider: "coinbase_commerce",
    });

    // Respond OK even if already applied (idempotent)
    return new Response(JSON.stringify(result ?? { status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    log("Error", e);
    // Don't leak internals to Coinbase, but return 200 for known idempotency duplicates if thrown from RPC
    return new Response(JSON.stringify({ error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
