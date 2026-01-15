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
 * Routes:
 * - GET /api/notifications - Get user's notifications
 * - GET /api/notifications/unread-count - Get unread notification count
 * - POST /api/notifications - Create a notification
 * - PATCH /api/notifications/:id/read - Mark notification as read
 * - PATCH /api/notifications/read-all - Mark all notifications as read
 * - DELETE /api/notifications/:id - Delete a notification
 */

// Response helpers
function jsonResponse(data: object, status: number = 200, origin?: string | null): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "content-type, authorization";
    headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function errorResponse(message: string, status: number = 400, origin?: string | null): Response {
  return jsonResponse({ error: message, ok: false }, status, origin);
}

// UUID validation
function isValidUUID(str: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

// Get Supabase client with service role
function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = Netlify.env.get("VITE_SUPABASE_URL") || Netlify.env.get("SUPABASE_URL");
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
  supabase: SupabaseClient
): Promise<{ userId: string; profileId: string } | null> {
  if (!token.startsWith("wallet:")) return null;

  const walletAddress = token.replace("wallet:", "").trim().toLowerCase();
  if (!isWalletAddress(walletAddress)) return null;

  // Look up user by wallet address
  const { data: user, error } = await supabase
    .from("canonical_users")
    .select("id, privy_user_id, wallet_address, base_wallet_address, canonical_user_id")
    .or(`wallet_address.ilike.${walletAddress},base_wallet_address.ilike.${walletAddress}`)
    .maybeSingle();

  if (error) {
    console.error("[notification-service] Error looking up user:", error);
  }

  // If user exists, return their info
  if (user) {
    const canonicalUserId = toPrizePid(user.privy_user_id || walletAddress);
    return {
      userId: canonicalUserId,
      profileId: user.id,
    };
  }

  // User not found - they need to complete registration first
  // NOTE: We do NOT create users here - users must register through the auth flow
  console.warn("[notification-service] No registered user found for wallet:", walletAddress);
  console.warn("[notification-service] Users must complete sign-up/login before connecting a wallet");
  return null;
}

// Get authenticated user from request
async function getAuthenticatedUser(
  request: Request,
  supabase: SupabaseClient
): Promise<{ userId: string; profileId: string } | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token || token.length < 10) return null;

  // Try wallet token first
  const walletUser = await verifyWalletToken(token, supabase);
  if (walletUser) return walletUser;

  // Fallback to Supabase auth
  const anonKey = Netlify.env.get("VITE_SUPABASE_ANON_KEY") || Netlify.env.get("SUPABASE_ANON_KEY");
  const supabaseUrl = Netlify.env.get("VITE_SUPABASE_URL") || Netlify.env.get("SUPABASE_URL");

  if (!anonKey || !supabaseUrl) return null;

  const anonClient = createClient(supabaseUrl, anonKey);
  const { data: { user }, error } = await anonClient.auth.getUser(token);

  if (error || !user) return null;

  return { userId: user.id, profileId: user.id };
}

// Route handlers
async function handleGetNotifications(
  profileId: string,
  supabase: SupabaseClient
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
  supabase: SupabaseClient
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
  supabase: SupabaseClient
): Promise<Response> {
  const { type, title, message, competition_id, prize_info, expires_at, read } = body;

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
    console.error("Error creating notification:", error);
    return errorResponse("Failed to create notification", 500);
  }

  return jsonResponse({ ok: true, notification: data });
}

async function handleMarkAsRead(
  profileId: string,
  notificationId: string,
  supabase: SupabaseClient
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
  supabase: SupabaseClient
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
  supabase: SupabaseClient
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

// Main handler
export default async (req: Request, context: Context): Promise<Response> => {
  const origin = req.headers.get("origin");

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Headers": "content-type, authorization",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      },
    });
  }

  try {
    const supabase = getSupabaseClient();

    // Verify authentication
    const authUser = await getAuthenticatedUser(req, supabase);
    if (!authUser) {
      return errorResponse("Unauthorized - valid Bearer token required", 401, origin);
    }

    // Parse route
    const url = new URL(req.url);
    const pathParts = url.pathname.replace("/api/notifications", "").split("/").filter(Boolean);

    // Parse body for POST/PATCH requests
    let body: Record<string, unknown> = {};
    if (req.method === "POST" || req.method === "PATCH") {
      try {
        body = await req.json();
      } catch {
        // No body is acceptable for some routes
      }
    }

    // Route handling
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
      return handleDeleteNotification(authUser.profileId, pathParts[0], supabase);
    }

    return errorResponse("Not found", 404, origin);
  } catch (err) {
    console.error("Notification service error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500,
      origin
    );
  }
};

export const config: Config = {
  path: "/api/notifications/*",
};
