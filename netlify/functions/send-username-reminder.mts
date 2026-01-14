import type { Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

export const config = {
  path: "/api/send-username-reminder",
};

interface ReminderRequest {
  email: string;
}

export default async function handler(request: Request, _context: Context) {
  const requestId = crypto.randomUUID().slice(0, 8);

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const body: ReminderRequest = await request.json();
    const { email } = body;

    if (!email) {
      return new Response(
        JSON.stringify({ success: false, error: "Email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sendgridApiKey = Netlify.env.get("SENDGRID_API_KEY");
    const fromEmail = Netlify.env.get("SENDGRID_FROM_EMAIL") || "contact@theprize.io";
    const supabaseUrl = Netlify.env.get("SUPABASE_URL") || Netlify.env.get("VITE_SUPABASE_URL");
    const supabaseKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") || Netlify.env.get("SUPABASE_ANON_KEY") || Netlify.env.get("VITE_SUPABASE_ANON_KEY");

    if (!sendgridApiKey) {
      console.error(`[send-username-reminder][${requestId}] SENDGRID_API_KEY not configured`);
      return new Response(
        JSON.stringify({ success: false, error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!supabaseUrl || !supabaseKey) {
      console.error(`[send-username-reminder][${requestId}] Supabase not configured`);
      return new Response(
        JSON.stringify({ success: false, error: "Database not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Look up the username in the database
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: userData, error: dbError } = await supabase
      .from('canonical_users')
      .select('username, email')
      .ilike('email', email.toLowerCase().trim())
      .maybeSingle();

    if (dbError) {
      console.error(`[send-username-reminder][${requestId}] Database error:`, dbError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to look up account" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!userData) {
      // Don't reveal whether the email exists or not for security
      console.log(`[send-username-reminder][${requestId}] No user found for email, but responding success`);
      return new Response(
        JSON.stringify({ success: true, message: "If an account exists, a reminder has been sent" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const username = userData.username || 'Unknown';

    // Send email via SendGrid
    const htmlContent = `
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
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 520px; margin: 0 auto; background-color: #101010; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);">
          <tr>
            <td style="padding: 40px 32px; text-align: center;">
              <h1 style="margin: 0 0 12px 0; color: #DDE404; font-size: 28px; font-weight: 700;">ThePrize.io</h1>
              <p style="margin: 0 0 32px 0; color: rgba(255,255,255,0.6); font-size: 14px;">Your Gateway to Winning</p>

              <div style="background: linear-gradient(135deg, rgba(0,82,255,0.15) 0%, rgba(0,82,255,0.05) 100%); border: 1px solid rgba(0,82,255,0.3); border-radius: 12px; padding: 24px; margin: 0 0 24px 0;">
                <h2 style="margin: 0 0 16px 0; color: #fff; font-size: 18px; font-weight: 600;">Username Reminder</h2>
                <p style="margin: 0 0 16px 0; color: rgba(255,255,255,0.7); font-size: 14px;">
                  You requested a reminder of your ThePrize.io username.
                </p>
                <div style="background-color: rgba(0,0,0,0.3); border-radius: 8px; padding: 16px; margin: 0 0 16px 0;">
                  <p style="margin: 0; color: #0052FF; font-size: 24px; font-weight: 700;">
                    ${username}
                  </p>
                </div>
                <p style="margin: 0; color: rgba(255,255,255,0.7); font-size: 14px;">
                  Use this username to sign in to your account.
                </p>
              </div>

              <a href="https://theprize.io" style="display: inline-block; background-color: #0052FF; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 14px;">
                Sign In Now
              </a>

              <p style="margin: 24px 0 0 0; color: rgba(255,255,255,0.5); font-size: 13px;">
                If you didn't request this reminder, you can safely ignore this email.
              </p>

              <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 24px; margin-top: 24px;">
                <p style="margin: 0; color: rgba(255,255,255,0.4); font-size: 12px;">
                  Need help? Contact us at support@theprize.io
                </p>
              </div>
            </td>
          </tr>
        </table>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 520px; margin: 24px auto 0;">
          <tr>
            <td style="text-align: center;">
              <p style="margin: 0; color: rgba(255,255,255,0.3); font-size: 12px;">
                &copy; 2024 ThePrize.io - All rights reserved
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const textContent = `ThePrize.io Username Reminder\n\nYou requested a reminder of your ThePrize.io username.\n\nYour username is: ${username}\n\nUse this username to sign in to your account at https://theprize.io\n\nIf you didn't request this reminder, you can safely ignore this email.`;

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendgridApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: userData.email }] }],
        from: { email: fromEmail, name: "ThePrize.io" },
        subject: "Your ThePrize.io username reminder",
        content: [
          { type: "text/plain", value: textContent },
          { type: "text/html", value: htmlContent },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[send-username-reminder][${requestId}] SendGrid error: ${response.status}`, errorText);

      return new Response(
        JSON.stringify({ success: false, error: "Failed to send reminder email" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[send-username-reminder][${requestId}] Username reminder sent to ${email}`);
    return new Response(
      JSON.stringify({ success: true, message: "Username reminder sent" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error(`[send-username-reminder][${requestId}] Error:`, error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
