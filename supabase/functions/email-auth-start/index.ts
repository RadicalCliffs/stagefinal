import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Inlined CORS configuration (bundler doesn't support shared module imports)
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://substage.theprize.io';
const ALLOWED_ORIGINS = [
  SITE_URL,
  'https://substage.theprize.io',
  'https://theprize.io',
  'https://theprizeio.netlify.app',
  'https://www.theprize.io',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8888',
];

function getCorsOrigin(requestOrigin: string | null): string {
  if (requestOrigin && ALLOWED_ORIGINS.includes(requestOrigin)) {
    return requestOrigin;
  }
  return SITE_URL;
}

function buildCorsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = getCorsOrigin(requestOrigin);
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, cache-control, pragma, expires',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function handleCorsOptions(req: Request): Response {
  const origin = req.headers.get('origin');
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(origin),
  });
}

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
}

async function sendVerificationEmail(
  email: string,
  code: string,
  requestId: string
): Promise<{ success: boolean; error?: string }> {
  const sendgridApiKey = Deno.env.get("SENDGRID_API_KEY");
  const fromEmail = Deno.env.get("SENDGRID_FROM_EMAIL") || "contact@theprize.io";

  if (!sendgridApiKey) {
    console.error(`[email-auth-start][${requestId}] SENDGRID_API_KEY not configured`);
    return { success: false, error: "Email service not configured" };
  }

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendgridApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email }],
          },
        ],
        from: {
          email: fromEmail,
          name: "ThePrize.io",
        },
        subject: "Your ThePrize.io verification code",
        content: [
          {
            type: "text/plain",
            value: `Your ThePrize.io verification code is: ${code}\n\nThis code will expire in 10 minutes.\n\nIf you did not request this code, please ignore this email.`,
          },
          {
            type: "text/html",
            value: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #0a0a0a;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 480px; margin: 0 auto; background-color: #101010; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);">
          <tr>
            <td style="padding: 40px 32px; text-align: center;">
              <h1 style="margin: 0 0 24px 0; color: #DDE404; font-size: 24px; font-weight: 700;">ThePrize.io</h1>
              <p style="margin: 0 0 24px 0; color: rgba(255,255,255,0.8); font-size: 16px; line-height: 1.5;">
                Your verification code is:
              </p>
              <div style="background-color: rgba(221,228,4,0.1); border: 1px solid rgba(221,228,4,0.3); border-radius: 8px; padding: 20px; margin: 0 0 24px 0;">
                <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #DDE404;">${code}</span>
              </div>
              <p style="margin: 0 0 8px 0; color: rgba(255,255,255,0.6); font-size: 14px;">
                This code will expire in 10 minutes.
              </p>
              <p style="margin: 0; color: rgba(255,255,255,0.4); font-size: 12px;">
                If you did not request this code, please ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[email-auth-start][${requestId}] SendGrid error: ${response.status}`,
        errorText
      );
      return { success: false, error: "Failed to send email" };
    }

    console.log(`[email-auth-start][${requestId}] Verification email sent to ${email}`);
    return { success: true };
  } catch (err) {
    console.error(`[email-auth-start][${requestId}] SendGrid request failed`, err);
    return { success: false, error: "Failed to send email" };
  }
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  // Handle CORS preflight - no auth required
  if (req.method === "OPTIONS") {
    return handleCorsOptions(req);
  }

  // Get origin for CORS headers on all responses
  const corsHeaders = buildCorsHeaders(req.headers.get('origin'));

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(`[email-auth-start][${requestId}] Missing Supabase config`);
      return new Response(
        JSON.stringify({ success: false, error: "Server misconfigured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch((err) => {
      console.error(`[email-auth-start][${requestId}] Invalid JSON`, err);
      return null;
    });

    if (!body || !body.email) {
      return new Response(
        JSON.stringify({ success: false, error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const email = String(body.email).trim().toLowerCase();
    if (!email.includes("@")) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    const { data, error } = await supabase
      .from("email_auth_sessions")
      .insert({
        email,
        verification_code: code,
        expires_at: expiresAt,
      })
      .select("id, expires_at")
      .single();

    if (error) {
      console.error(`[email-auth-start][${requestId}] Insert failed`, error);
      return new Response(
        JSON.stringify({ success: false, error: "Could not start verification" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Send verification email via SendGrid
    const emailResult = await sendVerificationEmail(email, code, requestId);
    if (!emailResult.success) {
      // Delete the session since we couldn't send the email
      await supabase.from("email_auth_sessions").delete().eq("id", data.id);
      return new Response(
        JSON.stringify({ success: false, error: emailResult.error || "Failed to send verification email" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        sessionId: data.id,
        expiresAt: data.expires_at,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error(`[email-auth-start][${requestId}] Fatal error`, error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
