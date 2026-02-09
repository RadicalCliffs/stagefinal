import type { Context } from "@netlify/functions";

export const config = {
  path: "/api/send-test-email",
};

interface TestEmailRequest {
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
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const body: TestEmailRequest = await request.json();
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

    if (!sendgridApiKey) {
      console.error(`[send-test-email][${requestId}] SENDGRID_API_KEY not configured`);
      return new Response(
        JSON.stringify({ success: false, error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const timestamp = new Date().toISOString();

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
              <p style="margin: 0 0 32px 0; color: rgba(255,255,255,0.6); font-size: 14px;">Email Service Test</p>

              <div style="background: linear-gradient(135deg, rgba(221,228,4,0.15) 0%, rgba(221,228,4,0.05) 100%); border: 1px solid rgba(221,228,4,0.3); border-radius: 12px; padding: 24px; margin: 0 0 24px 0;">
                <h2 style="margin: 0 0 16px 0; color: #fff; font-size: 18px; font-weight: 600;">✅ Email Service Working!</h2>
                <p style="margin: 0 0 16px 0; color: rgba(255,255,255,0.7); font-size: 14px;">
                  This is a test email from ThePrize.io notification system.
                </p>
                <p style="margin: 0; color: rgba(255,255,255,0.5); font-size: 13px;">
                  If you received this email, the SendGrid email service is properly configured and operational.
                </p>
              </div>

              <div style="background-color: rgba(0,0,0,0.3); border-radius: 8px; padding: 16px; margin: 0 0 24px 0;">
                <p style="margin: 0 0 8px 0; color: rgba(255,255,255,0.5); font-size: 12px;">Test Details:</p>
                <p style="margin: 0 0 4px 0; color: rgba(255,255,255,0.7); font-size: 13px;">
                  <strong>Sent to:</strong> ${email}
                </p>
                <p style="margin: 0 0 4px 0; color: rgba(255,255,255,0.7); font-size: 13px;">
                  <strong>Timestamp:</strong> ${timestamp}
                </p>
                <p style="margin: 0; color: rgba(255,255,255,0.7); font-size: 13px;">
                  <strong>Request ID:</strong> ${requestId}
                </p>
              </div>

              <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 24px;">
                <p style="margin: 0; color: rgba(255,255,255,0.4); font-size: 12px;">
                  This is an automated test email. No action required.
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

    const textContent = `ThePrize.io Email Service Test

Email Service Working!

This is a test email from ThePrize.io notification system.
If you received this email, the SendGrid email service is properly configured and operational.

Test Details:
- Sent to: ${email}
- Timestamp: ${timestamp}
- Request ID: ${requestId}

This is an automated test email. No action required.

© 2024 ThePrize.io - All rights reserved`;

    console.log(`[send-test-email][${requestId}] Sending test email to ${email}`);

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendgridApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: fromEmail, name: "ThePrize.io" },
        subject: "ThePrize.io - Email Service Test",
        content: [
          { type: "text/plain", value: textContent },
          { type: "text/html", value: htmlContent },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[send-test-email][${requestId}] SendGrid error: ${response.status}`, errorText);

      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to send test email",
          details: errorText,
          status: response.status
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[send-test-email][${requestId}] Test email sent successfully to ${email}`);
    return new Response(
      JSON.stringify({
        success: true,
        message: "Test email sent successfully",
        email,
        timestamp,
        requestId
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error(`[send-test-email][${requestId}] Error:`, error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
