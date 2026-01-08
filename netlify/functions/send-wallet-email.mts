import type { Context } from "@netlify/functions";

export const config = {
  path: "/api/send-wallet-email",
};

interface WalletEmailRequest {
  email: string;
  walletAddress: string;
  type: 'new_wallet' | 'welcome_back';
}

export default async function handler(request: Request, _context: Context) {
  const requestId = crypto.randomUUID().slice(0, 8);

  // CORS headers
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
    const body: WalletEmailRequest = await request.json();
    const { email, walletAddress, type } = body;

    if (!email || !walletAddress) {
      return new Response(
        JSON.stringify({ success: false, error: "Email and wallet address are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sendgridApiKey = Netlify.env.get("SENDGRID_API_KEY");
    const fromEmail = Netlify.env.get("SENDGRID_FROM_EMAIL") || "contact@theprize.io";

    if (!sendgridApiKey) {
      console.error(`[send-wallet-email][${requestId}] SENDGRID_API_KEY not configured`);
      return new Response(
        JSON.stringify({ success: false, error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const truncatedAddress = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;

    const isNewWallet = type === 'new_wallet';
    const subject = isNewWallet
      ? "🎉 Your ThePrize.io Base Wallet is Ready!"
      : "Welcome Back to ThePrize.io";

    const htmlContent = isNewWallet ? `
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
                <h2 style="margin: 0 0 16px 0; color: #DDE404; font-size: 20px; font-weight: 600;">🎉 Congratulations!</h2>
                <p style="margin: 0 0 16px 0; color: rgba(255,255,255,0.9); font-size: 16px; line-height: 1.5;">
                  Your free Base wallet has been created successfully!
                </p>
              </div>

              <div style="background-color: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin: 0 0 24px 0;">
                <p style="margin: 0 0 8px 0; color: rgba(255,255,255,0.5); font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Your Base Wallet Address</p>
                <p style="margin: 0; color: #fff; font-size: 14px; font-family: 'Courier New', monospace; word-break: break-all;">
                  ${walletAddress}
                </p>
              </div>

              <div style="background-color: rgba(0,82,255,0.1); border: 1px solid rgba(0,82,255,0.3); border-radius: 8px; padding: 16px; margin: 0 0 24px 0;">
                <p style="margin: 0; color: rgba(255,255,255,0.8); font-size: 14px; line-height: 1.5;">
                  💡 <strong style="color: #0052FF;">Built on Base</strong> - Your wallet is powered by Coinbase's Base network, ensuring fast and low-cost transactions.
                </p>
              </div>

              <div style="text-align: left; margin: 0 0 24px 0;">
                <h3 style="margin: 0 0 12px 0; color: #DDE404; font-size: 16px;">What's Next?</h3>
                <ul style="margin: 0; padding: 0 0 0 20px; color: rgba(255,255,255,0.8); font-size: 14px; line-height: 1.8;">
                  <li>Complete your profile setup</li>
                  <li>Top up your account with USDC</li>
                  <li>Enter competitions and win amazing prizes!</li>
                </ul>
              </div>

              <a href="https://theprize.io" style="display: inline-block; background-color: #DDE404; color: #000; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px; margin: 0 0 24px 0;">
                Start Playing Now
              </a>

              <p style="margin: 0; color: rgba(255,255,255,0.4); font-size: 12px;">
                Keep this email for your records. Never share your wallet credentials with anyone.
              </p>
            </td>
          </tr>
        </table>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 520px; margin: 24px auto 0;">
          <tr>
            <td style="text-align: center;">
              <p style="margin: 0; color: rgba(255,255,255,0.3); font-size: 12px;">
                © 2024 ThePrize.io - All rights reserved
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>` : `
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
              <h2 style="margin: 0 0 24px 0; color: rgba(255,255,255,0.9); font-size: 22px;">Welcome Back! 👋</h2>

              <p style="margin: 0 0 24px 0; color: rgba(255,255,255,0.7); font-size: 16px; line-height: 1.5;">
                Your Base wallet is still ready and waiting for you.
              </p>

              <div style="background-color: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin: 0 0 24px 0;">
                <p style="margin: 0 0 8px 0; color: rgba(255,255,255,0.5); font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Your Wallet</p>
                <p style="margin: 0; color: #fff; font-size: 14px; font-family: 'Courier New', monospace;">
                  ${truncatedAddress}
                </p>
              </div>

              <a href="https://theprize.io" style="display: inline-block; background-color: #DDE404; color: #000; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px;">
                Continue to ThePrize.io
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const textContent = isNewWallet
      ? `Congratulations! Your free Base wallet has been created on ThePrize.io.\n\nYour Base Wallet Address: ${walletAddress}\n\nThis wallet is powered by Coinbase's Base network for fast and low-cost transactions.\n\nWhat's Next?\n- Complete your profile setup\n- Top up your account with USDC\n- Enter competitions and win amazing prizes!\n\nVisit https://theprize.io to start playing.\n\nKeep this email for your records. Never share your wallet credentials with anyone.`
      : `Welcome back to ThePrize.io!\n\nYour wallet (${truncatedAddress}) is ready and waiting.\n\nVisit https://theprize.io to continue playing.`;

    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendgridApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: fromEmail, name: "ThePrize.io" },
        subject,
        content: [
          { type: "text/plain", value: textContent },
          { type: "text/html", value: htmlContent },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[send-wallet-email][${requestId}] SendGrid error: ${response.status}`, errorText);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to send email" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[send-wallet-email][${requestId}] Wallet email sent to ${email} (${type})`);
    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error(`[send-wallet-email][${requestId}] Error:`, error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
