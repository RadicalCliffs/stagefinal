import type { Context } from "@netlify/functions";

export const config = {
  path: "/api/create-user",
};

/**
 * Send welcome email using SendGrid dynamic template
 */
async function sendWelcomeEmail(
  email: string,
  username: string,
  requestId: string,
): Promise<void> {
  const sendgridApiKey = Netlify.env.get("SENDGRID_API_KEY");
  const fromEmail =
    Netlify.env.get("SENDGRID_FROM_EMAIL") || "contact@theprize.io";
  const templateId = Netlify.env.get("SENDGRID_TEMPLATE_WELCOME");

  if (!sendgridApiKey || !templateId) {
    console.log(
      `[create-user][${requestId}] SendGrid welcome email not configured, skipping`,
    );
    return;
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
            dynamic_template_data: {
              username: username,
              Competitions_URL: "https://theprize.io/competitions",
            },
          },
        ],
        from: { email: fromEmail, name: "ThePrize.io" },
        template_id: templateId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[create-user][${requestId}] Welcome email failed:`,
        errorText,
      );
    } else {
      console.log(`[create-user][${requestId}] Welcome email sent to ${email}`);
    }
  } catch (error) {
    console.error(`[create-user][${requestId}] Welcome email error:`, error);
  }
}

// Avatar URLs from Supabase public storage bucket "Avatars"
// These are the official 777btc avatars (EH-01 through EH-34)
const SUPABASE_AVATAR_BASE_URL =
  "https://mthwfldcjvpxjtmrqkqm.supabase.co/storage/v1/object/public/Avatars";
const AVATAR_FILENAMES = [
  "777btc_Avatars_EH-01.png",
  "777btc_Avatars_EH-02.png",
  "777btc_Avatars_EH-03.png",
  "777btc_Avatars_EH-04.png",
  "777btc_Avatars_EH-05.png",
  "777btc_Avatars_EH-06.png",
  "777btc_Avatars_EH-07.png",
  "777btc_Avatars_EH-08.png",
  "777btc_Avatars_EH-09.png",
  "777btc_Avatars_EH-10.png",
  "777btc_Avatars_EH-11.png",
  "777btc_Avatars_EH-12.png",
  "777btc_Avatars_EH-13.png",
  "777btc_Avatars_EH-14.png",
  "777btc_Avatars_EH-15.png",
  "777btc_Avatars_EH-16.png",
  "777btc_Avatars_EH-17.png",
  "777btc_Avatars_EH-18.png",
  "777btc_Avatars_EH-19.png",
  "777btc_Avatars_EH-20.png",
  "777btc_Avatars_EH-21.png",
  "777btc_Avatars_EH-22.png",
  "777btc_Avatars_EH-23.png",
  "777btc_Avatars_EH-24.png",
  "777btc_Avatars_EH-25.png",
  "777btc_Avatars_EH-26.png",
  "777btc_Avatars_EH-27.png",
  "777btc_Avatars_EH-28.png",
  "777btc_Avatars_EH-29.png",
  "777btc_Avatars_EH-30.png",
  "777btc_Avatars_EH-31.png",
  "777btc_Avatars_EH-32.png",
  "777btc_Avatars_EH-33.png",
  "777btc_Avatars_EH-34.png",
];

// Get a random avatar URL from the Supabase storage bucket
function getRandomAvatarUrl(): string {
  const randomIndex = Math.floor(Math.random() * AVATAR_FILENAMES.length);
  return `${SUPABASE_AVATAR_BASE_URL}/${AVATAR_FILENAMES[randomIndex]}`;
}

interface CreateUserRequest {
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  telegram?: string;
  avatar?: string;
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
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  try {
    const body: CreateUserRequest = await request.json();
    const { username, email, firstName, lastName, country, telegram, avatar } =
      body;

    if (!username || !email) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Username and email are required",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUrl =
      Netlify.env.get("SUPABASE_URL") || Netlify.env.get("VITE_SUPABASE_URL");
    const supabaseServiceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error(`[create-user][${requestId}] Supabase not configured`);
      return new Response(
        JSON.stringify({ success: false, error: "Database not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedUsername = username.toLowerCase().trim();

    console.log(
      `[create-user][${requestId}] Creating user: ${normalizedUsername} (${normalizedEmail})`,
    );

    // Check if email was verified (lookup in email_auth_sessions)
    const verifyCheckResponse = await fetch(
      `${supabaseUrl}/rest/v1/email_auth_sessions?email=eq.${encodeURIComponent(normalizedEmail)}&verified_at=not.is.null&order=verified_at.desc&limit=1`,
      {
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
      },
    );

    const verifiedSessions = await verifyCheckResponse.json();
    if (!verifiedSessions || verifiedSessions.length === 0) {
      console.log(
        `[create-user][${requestId}] Email not verified: ${normalizedEmail}`,
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: "Email not verified. Please verify your email first.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Check if session has expired
    const session = verifiedSessions[0];
    if (session.expires_at && new Date(session.expires_at) < new Date()) {
      console.log(
        `[create-user][${requestId}] Email verification expired for: ${normalizedEmail}`,
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: "Email verification expired. Please verify your email again.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Check if username or email already exists
    const existingCheckResponse = await fetch(
      `${supabaseUrl}/rest/v1/canonical_users?or=(username.ilike.${encodeURIComponent(normalizedUsername)},email.eq.${encodeURIComponent(normalizedEmail)})&limit=1`,
      {
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
      },
    );

    const existingUsers = await existingCheckResponse.json();
    if (existingUsers && existingUsers.length > 0) {
      const existing = existingUsers[0];
      if (existing.email === normalizedEmail) {
        console.log(
          `[create-user][${requestId}] Email already registered: ${normalizedEmail}`,
        );
        return new Response(
          JSON.stringify({
            success: false,
            error: "Email already registered",
            existingUsername: existing.username,
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      if (existing.username?.toLowerCase() === normalizedUsername) {
        console.log(
          `[create-user][${requestId}] Username already taken: ${normalizedUsername}`,
        );
        return new Response(
          JSON.stringify({ success: false, error: "Username already taken" }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // Create user in canonical_users (without wallet - will be linked later)
    const createResponse = await fetch(
      `${supabaseUrl}/rest/v1/canonical_users`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          username: normalizedUsername,
          email: normalizedEmail,
          first_name: firstName || null,
          last_name: lastName || null,
          country: country || null,
          telegram_handle: telegram || null,
          avatar_url: avatar || getRandomAvatarUrl(),
          usdc_balance: 0,
          has_used_new_user_bonus: false,
          created_at: new Date().toISOString(),
        }),
      },
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error(
        `[create-user][${requestId}] Failed to create user:`,
        errorText,
      );
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create user" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const createdUsers = await createResponse.json();
    const createdUser = createdUsers[0];

    console.log(
      `[create-user][${requestId}] User created: ${createdUser.id} (${normalizedUsername})`,
    );

    // Send welcome email using SendGrid template
    await sendWelcomeEmail(normalizedEmail, normalizedUsername, requestId);

    // Create welcome notification for new user
    try {
      const welcomeNotification = {
        canonical_user_id: createdUser.id,
        user_id: createdUser.id,
        title: "👋 Welcome to ThePrize.io!",
        message:
          "Get started by exploring our active competitions and entering for a chance to win amazing prizes. Good luck!",
        type: "announcement",
        is_read: false,
        created_at: new Date().toISOString(),
      };

      const notificationResponse = await fetch(
        `${supabaseUrl}/rest/v1/user_notifications`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: supabaseServiceKey,
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify(welcomeNotification),
        },
      );

      if (!notificationResponse.ok) {
        console.error(
          `[create-user][${requestId}] Failed to create welcome notification`,
        );
      } else {
        console.log(
          `[create-user][${requestId}] Welcome notification created for user ${createdUser.id}`,
        );
      }
    } catch (error) {
      console.error(
        `[create-user][${requestId}] Error creating welcome notification:`,
        error,
      );
      // Don't fail user creation if notification fails
    }

    // Mark email_auth_session as used
    await fetch(
      `${supabaseUrl}/rest/v1/email_auth_sessions?email=eq.${encodeURIComponent(normalizedEmail)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          used_at: new Date().toISOString(),
        }),
      },
    );

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: createdUser.id,
          username: createdUser.username,
          email: createdUser.email,
        },
      }),
      {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error(`[create-user][${requestId}] Error:`, error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
}
