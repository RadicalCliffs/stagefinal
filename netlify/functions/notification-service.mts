import type { Context, Config } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toPrizePid, isWalletAddress } from "./_shared/userId.mts";

/**
 * Notification Service Function - Server-side notification management
 *
 * This function handles all notification operations that require bypassing
 * client-side RLS restrictions. It ensures proper user ownership validation
 * before performing any operations.
 *
 * User Routes:
 * - GET /api/notifications - Get user's notifications
 * - GET /api/notifications/unread-count - Get unread notification count
 * - POST /api/notifications - Create a notification for self
 * - PATCH /api/notifications/:id/read - Mark notification as read
 * - PATCH /api/notifications/read-all - Mark all notifications as read
 * - DELETE /api/notifications/:id - Delete a notification
 *
 * Admin Routes (requires is_admin = true OR valid ADMIN_API_KEY):
 * - POST /api/notifications/admin/push - Push notification to specific users or all users
 * - POST /api/notifications/admin/template - Push notification using predefined template
 * - GET /api/notifications/admin/stats - Get notification statistics
 * - GET /api/notifications/admin/templates - List available notification templates
 */

// Notification Templates - Short, digestible versions of email notifications
const NOTIFICATION_TEMPLATES = {
  // Winner notification - matches SENDGRID_TEMPLATE_WINNER
  winner: {
    type: "win" as const,
    title: "🎉 You Won!",
    messageTemplate:
      "Congratulations! Ticket {{ticket_number}} won {{prize_name}}! {{action_text}}",
    defaultAction: "Check your dashboard for details.",
  },

  // Competition closing soon - matches SENDGRID_TEMPLATE_CLOSING_SOON
  closing_soon: {
    type: "special_offer" as const,
    title: "⏰ Closing Soon!",
    messageTemplate:
      "{{prize_name}} closes in {{hours_remaining}}! Only {{tickets_remaining}} tickets left at {{entry_price}}.",
    defaultAction: "Enter now before it's too late!",
  },

  // Competition live - matches SENDGRID_TEMPLATE_COMP_LIVE
  comp_live: {
    type: "announcement" as const,
    title: "🚀 New Competition Live!",
    messageTemplate:
      "{{competition_name}} is now live! Win {{prize_value}}. Entries from {{ticket_price}}.",
    defaultAction: "",
  },

  // Welcome notification - matches SENDGRID_TEMPLATE_WELCOME
  welcome: {
    type: "announcement" as const,
    title: "👋 Welcome to ThePrize.io!",
    messageTemplate:
      "Hey {{username}}! Your account is ready. Explore active competitions and start winning today!",
    defaultAction: "",
  },

  // FOMO notification - matches SENDGRID_TEMPLATE_FOMO
  fomo: {
    type: "special_offer" as const,
    title: "🔥 Don't Miss Out!",
    messageTemplate:
      "{{active_competitions}} competitions are live with {{total_prizes}} in prizes. Others are entering - will you?",
    defaultAction: "",
  },

  // Payment confirmation
  payment_success: {
    type: "payment" as const,
    title: "✅ Payment Successful",
    messageTemplate:
      "Your payment of {{amount}} was processed successfully. {{details}}",
    defaultAction: "",
  },

  // Top-up confirmation
  topup_success: {
    type: "topup" as const,
    title: "💰 Top-Up Successful",
    messageTemplate:
      "{{amount}} has been added to your wallet. Your new balance is {{balance}}.",
    defaultAction: "",
  },

  // Entry confirmation
  entry_confirmed: {
    type: "entry" as const,
    title: "🎟️ Entry Confirmed",
    messageTemplate:
      "You're in! {{ticket_count}} ticket(s) for {{competition_name}}. Good luck!",
    defaultAction: "",
  },

  // Competition ended - no winner
  competition_ended: {
    type: "competition_ended" as const,
    title: "🏁 Competition Ended",
    messageTemplate:
      "{{competition_name}} has ended. The winner has been drawn. Check results!",
    defaultAction: "",
  },

  // Custom announcement
  custom_announcement: {
    type: "announcement" as const,
    title: "📢 {{title}}",
    messageTemplate: "{{message}}",
    defaultAction: "",
  },

  // Custom special offer
  custom_offer: {
    type: "special_offer" as const,
    title: "🎁 {{title}}",
    messageTemplate: "{{message}}",
    defaultAction: "",
  },
} as const;

type TemplateKey = keyof typeof NOTIFICATION_TEMPLATES;

// Helper to fill template placeholders
function fillTemplate(
  template: string,
  data: Record<string, string | number | undefined>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null) {
      result = result.replace(
        new RegExp(`\\{\\{${key}\\}\\}`, "g"),
        String(value),
      );
    }
  }
  // Remove any unfilled placeholders
  result = result.replace(/\{\{[^}]+\}\}/g, "");
  return result.trim();
}

// Response helpers
function jsonResponse(
  data: object,
  status: number = 200,
  origin?: string | null,
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "content-type, authorization";
    headers["Access-Control-Allow-Methods"] =
      "GET, POST, PATCH, DELETE, OPTIONS";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function errorResponse(
  message: string,
  status: number = 400,
  origin?: string | null,
): Response {
  return jsonResponse({ error: message, ok: false }, status, origin);
}

// UUID validation
function isValidUUID(str: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// Get Supabase client with service role
function getSupabaseClient(): SupabaseClient {
  const supabaseUrl =
    Netlify.env.get("VITE_SUPABASE_URL") || Netlify.env.get("SUPABASE_URL");
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Verify wallet token authentication
// NOTE: Users MUST go through sign-up/login before connecting a wallet.
// There are no "wallet-only" users - this function only looks up existing users.
async function verifyWalletToken(
  token: string,
  supabase: SupabaseClient,
): Promise<{ userId: string; profileId: string; isAdmin: boolean } | null> {
  if (!token.startsWith("wallet:")) return null;

  const walletAddress = token.replace("wallet:", "").trim().toLowerCase();
  if (!isWalletAddress(walletAddress)) return null;

  // Look up user by wallet address - check all wallet columns
  // Use explicit ilike patterns for case-insensitive matching
  const { data: user, error } = await supabase
    .from("canonical_users")
    .select(
      "id, privy_user_id, wallet_address, base_wallet_address, eth_wallet_address, canonical_user_id, is_admin",
    )
    .or(
      `wallet_address.ilike.${walletAddress},base_wallet_address.ilike.${walletAddress},eth_wallet_address.ilike.${walletAddress},privy_user_id.ilike.${walletAddress}`,
    )
    .maybeSingle();

  if (error) {
    console.error("[notification-service] Error looking up user:", error);
    // Don't return null on error - try alternative lookup
  }

  // If user exists, return their info
  if (user) {
    const canonicalUserId = toPrizePid(
      user.privy_user_id || user.wallet_address || walletAddress,
    );
    return {
      userId: canonicalUserId,
      profileId: user.id,
      isAdmin: user.is_admin === true,
    };
  }

  // Fallback: try looking up by canonical_user_id (in case wallet was stored there)
  const canonicalId = `prize:pid:${walletAddress}`;
  const { data: userByCanonical, error: canonicalError } = await supabase
    .from("canonical_users")
    .select("id, privy_user_id, wallet_address, canonical_user_id, is_admin")
    .eq("canonical_user_id", canonicalId)
    .maybeSingle();

  if (!canonicalError && userByCanonical) {
    return {
      userId: canonicalId,
      profileId: userByCanonical.id,
      isAdmin: userByCanonical.is_admin === true,
    };
  }

  // User not found - they need to complete registration first
  // NOTE: We do NOT create users here - users must register through the auth flow
  console.warn(
    "[notification-service] No registered user found for wallet:",
    walletAddress,
  );
  console.warn(
    "[notification-service] Users must complete sign-up/login before connecting a wallet",
  );
  return null;
}

// Verify Admin API Key (for external admin dashboard integration)
function verifyAdminApiKey(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  const apiKeyHeader = request.headers.get("X-Admin-Api-Key");

  const adminApiKey = Netlify.env.get("ADMIN_API_KEY");
  if (!adminApiKey) {
    console.warn("[notification-service] ADMIN_API_KEY not configured");
    return false;
  }

  // Check X-Admin-Api-Key header first
  if (apiKeyHeader && apiKeyHeader === adminApiKey) {
    return true;
  }

  // Also check Bearer token for API key
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "").trim();
    if (token === adminApiKey) {
      return true;
    }
  }

  return false;
}

// Get authenticated user from request
async function getAuthenticatedUser(
  request: Request,
  supabase: SupabaseClient,
): Promise<{ userId: string; profileId: string; isAdmin: boolean } | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token || token.length < 10) return null;

  // Try wallet token first
  const walletUser = await verifyWalletToken(token, supabase);
  if (walletUser) return walletUser;

  // Fallback to Supabase auth
  const anonKey =
    Netlify.env.get("VITE_SUPABASE_ANON_KEY") ||
    Netlify.env.get("SUPABASE_ANON_KEY");
  const supabaseUrl =
    Netlify.env.get("VITE_SUPABASE_URL") || Netlify.env.get("SUPABASE_URL");

  if (!anonKey || !supabaseUrl) return null;

  const anonClient = createClient(supabaseUrl, anonKey);
  const {
    data: { user },
    error,
  } = await anonClient.auth.getUser(token);

  if (error || !user) return null;

  // Check if Supabase user is admin
  const { data: profile } = await supabase
    .from("canonical_users")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  return {
    userId: user.id,
    profileId: user.id,
    isAdmin: profile?.is_admin === true,
  };
}

// Route handlers
async function handleGetNotifications(
  profileId: string,
  supabase: SupabaseClient,
): Promise<Response> {
  const { data, error } = await supabase
    .from("user_notifications")
    .select("*")
    .eq("user_id", profileId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching notifications:", error);
    return errorResponse("Failed to fetch notifications", 500);
  }

  return jsonResponse({ ok: true, notifications: data || [] });
}

async function handleGetUnreadCount(
  profileId: string,
  supabase: SupabaseClient,
): Promise<Response> {
  const { count, error } = await supabase
    .from("user_notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", profileId)
    .eq("read", false);

  if (error) {
    console.error("Error fetching unread count:", error);
    return errorResponse("Failed to fetch unread count", 500);
  }

  return jsonResponse({ ok: true, count: count || 0 });
}

async function handleCreateNotification(
  profileId: string,
  body: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<Response> {
  const { type, title, message, competition_id, prize_info, expires_at, read } =
    body;

  if (!type || !title || !message) {
    return errorResponse("Missing required fields: type, title, message");
  }

  const { data, error } = await supabase
    .from("user_notifications")
    .insert({
      user_id: profileId, // Always use the authenticated user's profile ID
      type,
      title,
      message,
      competition_id: competition_id || null,
      prize_info: prize_info || null,
      expires_at: expires_at || null,
      read: read === true, // Support setting read status for backfilled notifications
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error("[notification-service] Error creating notification:", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return errorResponse(`Failed to create notification: ${error.message || error.code || 'Unknown error'}`, 500);
  }

  return jsonResponse({ ok: true, notification: data });
}

async function handleMarkAsRead(
  profileId: string,
  notificationId: string,
  supabase: SupabaseClient,
): Promise<Response> {
  if (!isValidUUID(notificationId)) {
    return errorResponse("Invalid notification ID");
  }

  // Verify ownership before updating
  const { data: notification, error: fetchError } = await supabase
    .from("user_notifications")
    .select("user_id")
    .eq("id", notificationId)
    .single();

  if (fetchError || !notification) {
    return errorResponse("Notification not found", 404);
  }

  if (notification.user_id !== profileId) {
    return errorResponse("Not authorized to modify this notification", 403);
  }

  const { error } = await supabase
    .from("user_notifications")
    .update({ read: true })
    .eq("id", notificationId);

  if (error) {
    console.error("Error marking notification as read:", error);
    return errorResponse("Failed to mark notification as read", 500);
  }

  return jsonResponse({ ok: true });
}

async function handleMarkAllAsRead(
  profileId: string,
  supabase: SupabaseClient,
): Promise<Response> {
  const { error } = await supabase
    .from("user_notifications")
    .update({ read: true })
    .eq("user_id", profileId)
    .eq("read", false);

  if (error) {
    console.error("Error marking all notifications as read:", error);
    return errorResponse("Failed to mark all notifications as read", 500);
  }

  return jsonResponse({ ok: true });
}

async function handleDeleteNotification(
  profileId: string,
  notificationId: string,
  supabase: SupabaseClient,
): Promise<Response> {
  if (!isValidUUID(notificationId)) {
    return errorResponse("Invalid notification ID");
  }

  // Verify ownership before deleting
  const { data: notification, error: fetchError } = await supabase
    .from("user_notifications")
    .select("user_id")
    .eq("id", notificationId)
    .single();

  if (fetchError || !notification) {
    return errorResponse("Notification not found", 404);
  }

  if (notification.user_id !== profileId) {
    return errorResponse("Not authorized to delete this notification", 403);
  }

  const { error } = await supabase
    .from("user_notifications")
    .delete()
    .eq("id", notificationId);

  if (error) {
    console.error("Error deleting notification:", error);
    return errorResponse("Failed to delete notification", 500);
  }

  return jsonResponse({ ok: true });
}

// Admin: Push notification to specific users or all users
async function handleAdminPush(
  body: Record<string, unknown>,
  supabase: SupabaseClient,
  origin?: string | null,
): Promise<Response> {
  const {
    type = "announcement",
    title,
    message,
    user_ids,
    competition_id,
    prize_info,
    expires_at,
    send_to_all = false,
  } = body;

  if (!title || !message) {
    return errorResponse(
      "Missing required fields: title, message",
      400,
      origin,
    );
  }

  // Validate type
  const validTypes = [
    "win",
    "competition_ended",
    "special_offer",
    "announcement",
    "payment",
    "topup",
    "entry",
  ];
  if (!validTypes.includes(type as string)) {
    return errorResponse(
      `Invalid type. Must be one of: ${validTypes.join(", ")}`,
      400,
      origin,
    );
  }

  let targetUserIds: string[] = [];

  if (send_to_all) {
    // Get all users
    const { data: users, error } = await supabase
      .from("canonical_users")
      .select("id")
      .limit(10000); // Safety limit

    if (error) {
      console.error("[notification-service] Error fetching users:", error);
      return errorResponse("Failed to fetch users", 500, origin);
    }

    targetUserIds = (users || []).map((u) => u.id);
  } else if (Array.isArray(user_ids) && user_ids.length > 0) {
    // Validate user IDs exist
    const { data: users, error } = await supabase
      .from("canonical_users")
      .select("id")
      .in("id", user_ids);

    if (error) {
      console.error("[notification-service] Error validating users:", error);
      return errorResponse("Failed to validate user IDs", 500, origin);
    }

    targetUserIds = (users || []).map((u) => u.id);

    if (targetUserIds.length === 0) {
      return errorResponse("No valid user IDs provided", 400, origin);
    }
  } else {
    return errorResponse(
      "Must provide user_ids array or set send_to_all=true",
      400,
      origin,
    );
  }

  // Create notifications for all target users
  const notifications = targetUserIds.map((userId) => ({
    user_id: userId,
    type,
    title,
    message,
    competition_id: competition_id || null,
    prize_info: prize_info || null,
    expires_at: expires_at || null,
    read: false,
    created_at: new Date().toISOString(),
  }));

  // Insert in batches of 100 to avoid timeout
  const batchSize = 100;
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < notifications.length; i += batchSize) {
    const batch = notifications.slice(i, i + batchSize);
    const { error } = await supabase.from("user_notifications").insert(batch);

    if (error) {
      console.error("[notification-service] Batch insert error:", error);
      failed += batch.length;
    } else {
      inserted += batch.length;
    }
  }

  console.log(
    `[notification-service] Admin push: ${inserted} sent, ${failed} failed`,
  );

  return jsonResponse(
    {
      ok: true,
      sent: inserted,
      failed,
      total_targeted: targetUserIds.length,
    },
    200,
    origin,
  );
}

// Admin: Get notification statistics
async function handleAdminStats(
  supabase: SupabaseClient,
  origin?: string | null,
): Promise<Response> {
  // Get total notification count
  const { count: totalCount, error: totalError } = await supabase
    .from("user_notifications")
    .select("*", { count: "exact", head: true });

  if (totalError) {
    console.error(
      "[notification-service] Error fetching total count:",
      totalError,
    );
    return errorResponse("Failed to fetch statistics", 500, origin);
  }

  // Get unread count
  const { count: unreadCount, error: unreadError } = await supabase
    .from("user_notifications")
    .select("*", { count: "exact", head: true })
    .eq("read", false);

  if (unreadError) {
    console.error(
      "[notification-service] Error fetching unread count:",
      unreadError,
    );
    return errorResponse("Failed to fetch statistics", 500, origin);
  }

  // Get counts by type
  const { data: typeCounts, error: typeError } = await supabase
    .from("user_notifications")
    .select("type")
    .limit(100000);

  let byType: Record<string, number> = {};
  if (!typeError && typeCounts) {
    byType = typeCounts.reduce(
      (acc, n) => {
        acc[n.type] = (acc[n.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
  }

  // Get user count
  const { count: userCount, error: userError } = await supabase
    .from("canonical_users")
    .select("*", { count: "exact", head: true });

  return jsonResponse(
    {
      ok: true,
      stats: {
        total_notifications: totalCount || 0,
        unread_notifications: unreadCount || 0,
        by_type: byType,
        total_users: userCount || 0,
      },
    },
    200,
    origin,
  );
}

// Admin: Push notification using predefined template
async function handleAdminTemplatePush(
  body: Record<string, unknown>,
  supabase: SupabaseClient,
  origin?: string | null,
): Promise<Response> {
  const {
    template,
    data = {},
    user_ids,
    send_to_all = false,
    competition_id,
    prize_info,
    expires_at,
    amount,
  } = body;

  if (!template) {
    return errorResponse("Missing required field: template", 400, origin);
  }

  const templateKey = template as string;
  if (!(templateKey in NOTIFICATION_TEMPLATES)) {
    const availableTemplates = Object.keys(NOTIFICATION_TEMPLATES).join(", ");
    return errorResponse(
      `Invalid template. Available templates: ${availableTemplates}`,
      400,
      origin,
    );
  }

  const templateConfig = NOTIFICATION_TEMPLATES[templateKey as TemplateKey];
  const templateData = data as Record<string, string | number | undefined>;

  // Fill in template
  let title = fillTemplate(templateConfig.title, templateData);
  let message = fillTemplate(templateConfig.messageTemplate, templateData);

  // Add default action if message doesn't already end with a call to action
  if (templateConfig.defaultAction && !message.includes("!")) {
    message = message + " " + templateConfig.defaultAction;
  }

  // Get target users
  let targetUserIds: string[] = [];

  if (send_to_all) {
    const { data: users, error } = await supabase
      .from("canonical_users")
      .select("id")
      .limit(10000);

    if (error) {
      console.error("[notification-service] Error fetching users:", error);
      return errorResponse("Failed to fetch users", 500, origin);
    }

    targetUserIds = (users || []).map((u) => u.id);
  } else if (Array.isArray(user_ids) && user_ids.length > 0) {
    // Support looking up by email, username, or ID
    const lookupIds = user_ids as string[];

    // First try direct ID lookup
    const { data: usersById } = await supabase
      .from("canonical_users")
      .select("id")
      .in("id", lookupIds);

    const foundIds = new Set((usersById || []).map((u) => u.id));
    const remainingIds = lookupIds.filter((id) => !foundIds.has(id));

    // Look up remaining by email or username
    if (remainingIds.length > 0) {
      const { data: usersByEmail } = await supabase
        .from("canonical_users")
        .select("id")
        .in("email", remainingIds);

      (usersByEmail || []).forEach((u) => foundIds.add(u.id));

      const stillRemaining = remainingIds.filter((id) => {
        return !(usersByEmail || []).some((u) => u.id === id);
      });

      if (stillRemaining.length > 0) {
        const { data: usersByUsername } = await supabase
          .from("canonical_users")
          .select("id")
          .in("username", stillRemaining);

        (usersByUsername || []).forEach((u) => foundIds.add(u.id));
      }
    }

    targetUserIds = Array.from(foundIds);

    if (targetUserIds.length === 0) {
      return errorResponse("No valid users found", 400, origin);
    }
  } else {
    return errorResponse(
      "Must provide user_ids array or set send_to_all=true",
      400,
      origin,
    );
  }

  // Create notifications
  const notifications = targetUserIds.map((userId) => ({
    user_id: userId,
    type: templateConfig.type,
    title,
    message,
    competition_id: competition_id || null,
    prize_info: prize_info || null,
    amount: amount || null,
    expires_at: expires_at || null,
    read: false,
    created_at: new Date().toISOString(),
  }));

  // Insert in batches
  const batchSize = 100;
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < notifications.length; i += batchSize) {
    const batch = notifications.slice(i, i + batchSize);
    const { error } = await supabase.from("user_notifications").insert(batch);

    if (error) {
      console.error("[notification-service] Batch insert error:", error);
      failed += batch.length;
    } else {
      inserted += batch.length;
    }
  }

  console.log(
    `[notification-service] Template push (${templateKey}): ${inserted} sent, ${failed} failed`,
  );

  return jsonResponse(
    {
      ok: true,
      template: templateKey,
      title_sent: title,
      message_sent: message,
      sent: inserted,
      failed,
      total_targeted: targetUserIds.length,
    },
    200,
    origin,
  );
}

// Admin: Get available notification templates
async function handleGetTemplates(origin?: string | null): Promise<Response> {
  const templates = Object.entries(NOTIFICATION_TEMPLATES).map(
    ([key, config]) => ({
      key,
      type: config.type,
      title_preview: config.title,
      message_template: config.messageTemplate,
      default_action: config.defaultAction,
      // Extract placeholders from template
      placeholders: [
        ...(config.title + config.messageTemplate).matchAll(/\{\{(\w+)\}\}/g),
      ]
        .map((m) => m[1])
        .filter((v, i, a) => a.indexOf(v) === i), // unique
    }),
  );

  return jsonResponse(
    {
      ok: true,
      templates,
      usage: {
        endpoint: "POST /api/notifications/admin/template",
        example: {
          template: "winner",
          data: { ticket_number: "#1234", prize_name: "Bitcoin Prize" },
          user_ids: ["user-uuid-here"],
        },
      },
    },
    200,
    origin,
  );
}

// Main handler
export default async (req: Request, context: Context): Promise<Response> => {
  const origin = req.headers.get("origin");

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Headers":
          "content-type, authorization, x-admin-api-key",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      },
    });
  }

  try {
    const supabase = getSupabaseClient();

    // Parse route first to check if it's an admin route
    const url = new URL(req.url);
    const pathParts = url.pathname
      .replace("/api/notifications", "")
      .split("/")
      .filter(Boolean);

    // Parse body for POST/PATCH requests
    let body: Record<string, unknown> = {};
    if (req.method === "POST" || req.method === "PATCH") {
      try {
        body = await req.json();
      } catch {
        // No body is acceptable for some routes
      }
    }

    // Admin routes - support both user auth (is_admin) and API key auth
    if (pathParts[0] === "admin") {
      const hasAdminApiKey = verifyAdminApiKey(req);
      const authUser = await getAuthenticatedUser(req, supabase);
      const isAdminUser = authUser?.isAdmin === true;

      if (!hasAdminApiKey && !isAdminUser) {
        return errorResponse(
          "Forbidden - admin access required. Use X-Admin-Api-Key header or authenticate as admin user.",
          403,
          origin,
        );
      }

      if (req.method === "POST" && pathParts[1] === "push") {
        return handleAdminPush(body, supabase, origin);
      }

      if (req.method === "POST" && pathParts[1] === "template") {
        return handleAdminTemplatePush(body, supabase, origin);
      }

      if (req.method === "GET" && pathParts[1] === "stats") {
        return handleAdminStats(supabase, origin);
      }

      if (req.method === "GET" && pathParts[1] === "templates") {
        return handleGetTemplates(origin);
      }

      return errorResponse("Not found", 404, origin);
    }

    // User routes require authentication
    const authUser = await getAuthenticatedUser(req, supabase);
    if (!authUser) {
      return errorResponse(
        "Unauthorized - valid Bearer token required",
        401,
        origin,
      );
    }

    // User routes
    if (req.method === "GET") {
      if (pathParts[0] === "unread-count") {
        return handleGetUnreadCount(authUser.profileId, supabase);
      }
      return handleGetNotifications(authUser.profileId, supabase);
    }

    if (req.method === "POST" && pathParts.length === 0) {
      return handleCreateNotification(authUser.profileId, body, supabase);
    }

    if (req.method === "PATCH") {
      if (pathParts[0] === "read-all") {
        return handleMarkAllAsRead(authUser.profileId, supabase);
      }
      if (pathParts[1] === "read" && pathParts[0]) {
        return handleMarkAsRead(authUser.profileId, pathParts[0], supabase);
      }
    }

    if (req.method === "DELETE" && pathParts[0]) {
      return handleDeleteNotification(
        authUser.profileId,
        pathParts[0],
        supabase,
      );
    }

    return errorResponse("Not found", 404, origin);
  } catch (err) {
    console.error("Notification service error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500,
      origin,
    );
  }
};

export const config: Config = {
  path: ["/api/notifications", "/api/notifications/*"],
};
