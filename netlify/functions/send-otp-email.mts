import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export const config = {
  path: "/api/send-otp-email",
};

interface OtpRequest {
  email: string;
}

interface OtpRecord {
  code: string;
  email: string;
  createdAt: number;
  attempts: number;
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
    const body: OtpRequest = await request.json();
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
      console.error(`[send-otp-email][${requestId}] SENDGRID_API_KEY not configured`);
      return new Response(
        JSON.stringify({ success: false, error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP in Netlify Blobs with 10-minute expiry
    const store = getStore("otp-codes");
    const otpKey = `otp:${email.toLowerCase()}`;

    // Check for rate limiting (max 3 OTPs per email in 5 minutes)
    const existingOtp = await store.get(otpKey, { type: "json" }) as OtpRecord | null;
    if (existingOtp) {
      const timeSinceLastOtp = Date.now() - existingOtp.createdAt;
      const oneMinute = 60 * 1000;

      if (timeSinceLastOtp < oneMinute) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Please wait before requesting another code",
            retryAfter: Math.ceil((oneMinute - timeSinceLastOtp) / 1000)
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Store the OTP
    const otpRecord: OtpRecord = {
      code: otpCode,
      email: email.toLowerCase(),
      createdAt: Date.now(),
      attempts: 0,
    };

    await store.setJSON(otpKey, otpRecord);
    console.log(`[send-otp-email][${requestId}] OTP stored for ${email}`);

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

              <div style="background: linear-gradient(135deg, rgba(221,228,4,0.15) 0%, rgba(221,228,4,0.05) 100%); border: 1px solid rgba(221,228,4,0.3); border-radius: 12px; padding: 24px; margin: 0 0 24px 0;">
                <h2 style="margin: 0 0 16px 0; color: #fff; font-size: 18px; font-weight: 600;">Your Verification Code</h2>
                <div style="background-color: rgba(0,0,0,0.3); border-radius: 8px; padding: 20px; margin: 0 0 16px 0;">
                  <p style="margin: 0; color: #DDE404; font-size: 36px; font-weight: 700; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                    ${otpCode}
                  </p>
                </div>
                <p style="margin: 0; color: rgba(255,255,255,0.7); font-size: 14px;">
                  Enter this code to verify your email address
                </p>
              </div>

              <p style="margin: 0 0 24px 0; color: rgba(255,255,255,0.5); font-size: 13px;">
                This code expires in 10 minutes. If you didn't request this code, you can safely ignore this email.
              </p>

              <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 24px;">
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

    const textContent = `Your ThePrize.io verification code is: ${otpCode}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this code, you can safely ignore this email.`;

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendgridApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: fromEmail, name: "ThePrize.io" },
        subject: `${otpCode} is your ThePrize.io verification code`,
        content: [
          { type: "text/plain", value: textContent },
          { type: "text/html", value: htmlContent },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[send-otp-email][${requestId}] SendGrid error: ${response.status}`, errorText);

      // Clean up the stored OTP on send failure
      await store.delete(otpKey);

      return new Response(
        JSON.stringify({ success: false, error: "Failed to send verification email" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[send-otp-email][${requestId}] OTP email sent to ${email}`);
    return new Response(
      JSON.stringify({ success: true, message: "Verification code sent" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error(`[send-otp-email][${requestId}] Error:`, error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
