import type { Context, Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

export const config: Config = {
  path: "/api/confirm-pending-tickets/health",
  method: ["GET", "OPTIONS"],
};

// CORS headers
function corsHeaders(origin?: string | null) {
  const allowOrigin = origin && origin !== "null" ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
}

function json(data: unknown, status = 200, origin?: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

/**
 * Health Check Endpoint for Ticket Confirmation Proxy
 * 
 * Tests:
 * - Environment variables are present
 * - Supabase connection works
 * - Supabase Edge Function is reachable
 * - Database tables are accessible
 * 
 * Usage: GET /api/confirm-pending-tickets/health
 */
export default async (req: Request, _context: Context): Promise<Response> => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders(origin) });
  }

  const incidentId = `health-check-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const timestamp = new Date().toISOString();
  
  const checks: Record<string, { status: "pass" | "fail" | "warn"; message: string; details?: any }> = {};
  let overallHealthy = true;

  // 1. Check environment variables
  const envVars = {
    VITE_SUPABASE_URL: Netlify.env.get("VITE_SUPABASE_URL"),
    SUPABASE_URL: Netlify.env.get("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  };

  const supabaseUrl = envVars.VITE_SUPABASE_URL || envVars.SUPABASE_URL;
  const serviceRoleKey = envVars.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    checks.env_supabase_url = {
      status: "fail",
      message: "Missing SUPABASE_URL or VITE_SUPABASE_URL environment variable",
    };
    overallHealthy = false;
  } else {
    checks.env_supabase_url = {
      status: "pass",
      message: "Supabase URL configured",
      details: { url: supabaseUrl.substring(0, 30) + "..." },
    };
  }

  if (!serviceRoleKey) {
    checks.env_service_role_key = {
      status: "fail",
      message: "Missing SUPABASE_SERVICE_ROLE_KEY environment variable",
    };
    overallHealthy = false;
  } else {
    checks.env_service_role_key = {
      status: "pass",
      message: "Service role key configured",
      details: { keyLength: serviceRoleKey.length },
    };
  }

  // 2. Check Supabase connection
  if (supabaseUrl && serviceRoleKey) {
    try {
      const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Test database connectivity with a simple query
      const { data, error } = await supabase
        .from("competitions")
        .select("id")
        .limit(1);

      if (error) {
        checks.supabase_connection = {
          status: "fail",
          message: "Failed to connect to Supabase database",
          details: { error: error.message },
        };
        overallHealthy = false;
      } else {
        checks.supabase_connection = {
          status: "pass",
          message: "Supabase database connection successful",
        };
      }

      // Test confirmation_incident_log table
      try {
        const { error: logError } = await supabase
          .from("confirmation_incident_log")
          .select("id")
          .limit(1);

        if (logError) {
          checks.incident_log_table = {
            status: "warn",
            message: "Incident log table not accessible - logging may not work",
            details: { error: logError.message },
          };
        } else {
          checks.incident_log_table = {
            status: "pass",
            message: "Incident log table accessible",
          };
        }
      } catch (e) {
        checks.incident_log_table = {
          status: "warn",
          message: "Failed to check incident log table",
          details: { error: e instanceof Error ? e.message : String(e) },
        };
      }

      // Test pending_tickets table
      try {
        const { error: ptError } = await supabase
          .from("pending_tickets")
          .select("id")
          .limit(1);

        if (ptError) {
          checks.pending_tickets_table = {
            status: "fail",
            message: "pending_tickets table not accessible",
            details: { error: ptError.message },
          };
          overallHealthy = false;
        } else {
          checks.pending_tickets_table = {
            status: "pass",
            message: "pending_tickets table accessible",
          };
        }
      } catch (e) {
        checks.pending_tickets_table = {
          status: "fail",
          message: "Failed to query pending_tickets table",
          details: { error: e instanceof Error ? e.message : String(e) },
        };
        overallHealthy = false;
      }

    } catch (e) {
      checks.supabase_connection = {
        status: "fail",
        message: "Exception creating Supabase client",
        details: { error: e instanceof Error ? e.message : String(e) },
      };
      overallHealthy = false;
    }
  }

  // 3. Check Supabase Edge Function reachability
  if (supabaseUrl && serviceRoleKey) {
    try {
      const edgeFunctionUrl = `${supabaseUrl}/functions/v1/confirm-pending-tickets`;
      
      // Send a health check request to the Supabase Edge Function
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      try {
        const response = await fetch(edgeFunctionUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ _healthCheck: true }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok || response.status === 400 || response.status === 500) {
          // Any response (even error) means the function is reachable
          checks.supabase_edge_function = {
            status: "pass",
            message: "Supabase Edge Function reachable",
            details: { 
              status: response.status,
              url: edgeFunctionUrl.substring(0, 50) + "...",
            },
          };
        } else {
          checks.supabase_edge_function = {
            status: "warn",
            message: `Supabase Edge Function returned unexpected status: ${response.status}`,
            details: { status: response.status },
          };
        }
      } catch (fetchError: any) {
        if (fetchError.name === 'AbortError') {
          checks.supabase_edge_function = {
            status: "fail",
            message: "Supabase Edge Function request timed out",
            details: { timeout: "5 seconds" },
          };
          overallHealthy = false;
        } else {
          throw fetchError;
        }
      }
    } catch (e) {
      checks.supabase_edge_function = {
        status: "fail",
        message: "Failed to reach Supabase Edge Function",
        details: { error: e instanceof Error ? e.message : String(e) },
      };
      overallHealthy = false;
    }
  }

  // Prepare response
  const response = {
    healthy: overallHealthy,
    timestamp,
    incidentId,
    source: "netlify_proxy",
    endpoint: "/api/confirm-pending-tickets/health",
    environment: {
      netlify: true,
      nodeVersion: process.version,
      platform: process.platform,
    },
    checks,
  };

  const statusCode = overallHealthy ? 200 : 503;

  // Log to console for Netlify logs
  console.log(`[Health Check] ${overallHealthy ? "✅ PASS" : "❌ FAIL"} - ${timestamp} - incident: ${incidentId}`);
  console.log(`[Health Check] Details:`, JSON.stringify(checks, null, 2));

  return json(response, statusCode, origin);
};
