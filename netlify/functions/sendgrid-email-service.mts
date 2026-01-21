import type { Config, Context } from "@netlify/functions";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const config: Config = {
  path: "/api/send-email",
};

/**
 * SendGrid Email Service
 *
 * Uses SendGrid dynamic templates from the design library to send transactional emails.
 * Templates: WELCOME, WINNER, FOMO, COMP LIVE
 *
 * Dynamic template variables use the {{handlebars}} format, e.g., {{Player Username}}
 */

// Email types mapping to SendGrid template names
type EmailType = "welcome" | "winner" | "fomo" | "comp_live";

// Template data interfaces
interface WelcomeEmailData {
  username: string;
  email?: string;
}

interface WinnerEmailData {
  "Player Username": string;
  "Competition Name"?: string;
  "Prize Value"?: string;
  "Winning Ticket"?: string;
}

interface FomoEmailData {
  "Player Username": string;
  "Active Competitions"?: string;
  "Total Prizes"?: string;
}

interface CompLiveEmailData {
  "Player Username": string;
  "Competition Name"?: string;
  "Prize Value"?: string;
  "End Date"?: string;
  "Ticket Price"?: string;
}

type EmailTemplateData = WelcomeEmailData | WinnerEmailData | FomoEmailData | CompLiveEmailData;

interface SendEmailRequest {
  type: EmailType;
  to: string | string[];
  templateData: EmailTemplateData;
  // Optional: override recipient name
  toName?: string;
}

interface SendEmailResponse {
  success: boolean;
  message?: string;
  error?: string;
  messageId?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * Get the SendGrid template ID for a given email type.
 * Template IDs should be configured as environment variables.
 */
function getTemplateId(type: EmailType): string | null {
  const templateEnvMap: Record<EmailType, string> = {
    welcome: "SENDGRID_TEMPLATE_WELCOME",
    winner: "SENDGRID_TEMPLATE_WINNER",
    fomo: "SENDGRID_TEMPLATE_FOMO",
    comp_live: "SENDGRID_TEMPLATE_COMP_LIVE",
  };

  const envVar = templateEnvMap[type];
  return Netlify.env.get(envVar) || null;
}

/**
 * Send email using SendGrid dynamic template
 */
async function sendTemplateEmail(
  sendgridApiKey: string,
  fromEmail: string,
  toEmail: string | string[],
  templateId: string,
  dynamicData: Record<string, unknown>,
  toName?: string
): Promise<{ success: boolean; error?: string }> {
  const toArray = Array.isArray(toEmail) ? toEmail : [toEmail];

  const personalizations = toArray.map((email) => ({
    to: [{ email, name: toName }],
    dynamic_template_data: dynamicData,
  }));

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sendgridApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations,
      from: { email: fromEmail, name: "ThePrize.io" },
      template_id: templateId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[sendgrid-email-service] SendGrid error: ${response.status}`, errorText);
    return { success: false, error: `SendGrid error: ${response.status}` };
  }

  return { success: true };
}

export default async function handler(request: Request, _context: Context): Promise<Response> {
  const requestId = crypto.randomUUID().slice(0, 8);

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
    const body: SendEmailRequest = await request.json();
    const { type, to, templateData, toName } = body;

    if (!type || !to || !templateData) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields: type, to, templateData" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const validTypes: EmailType[] = ["welcome", "winner", "fomo", "comp_live"];
    if (!validTypes.includes(type)) {
      return new Response(
        JSON.stringify({ success: false, error: `Invalid email type. Valid types: ${validTypes.join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sendgridApiKey = Netlify.env.get("SENDGRID_API_KEY");
    const fromEmail = Netlify.env.get("SENDGRID_FROM_EMAIL") || "contact@theprize.io";

    if (!sendgridApiKey) {
      console.error(`[sendgrid-email-service][${requestId}] SENDGRID_API_KEY not configured`);
      return new Response(
        JSON.stringify({ success: false, error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const templateId = getTemplateId(type);
    if (!templateId) {
      console.error(`[sendgrid-email-service][${requestId}] Template ID not configured for type: ${type}`);
      return new Response(
        JSON.stringify({ success: false, error: `Template not configured for email type: ${type}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[sendgrid-email-service][${requestId}] Sending ${type} email to ${Array.isArray(to) ? to.length + " recipients" : to}`);

    const result = await sendTemplateEmail(
      sendgridApiKey,
      fromEmail,
      to,
      templateId,
      templateData as Record<string, unknown>,
      toName
    );

    if (!result.success) {
      return new Response(
        JSON.stringify({ success: false, error: result.error }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[sendgrid-email-service][${requestId}] Email sent successfully`);
    return new Response(
      JSON.stringify({ success: true, message: `${type} email sent successfully` }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error(`[sendgrid-email-service][${requestId}] Error:`, error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

// ---------- Helper functions for internal use by other functions ----------

/**
 * Send a welcome email to a new user
 */
export async function sendWelcomeEmail(
  email: string,
  username: string
): Promise<{ success: boolean; error?: string }> {
  const sendgridApiKey = Netlify.env.get("SENDGRID_API_KEY");
  const fromEmail = Netlify.env.get("SENDGRID_FROM_EMAIL") || "contact@theprize.io";
  const templateId = Netlify.env.get("SENDGRID_TEMPLATE_WELCOME");

  if (!sendgridApiKey || !templateId) {
    console.log("[sendWelcomeEmail] SendGrid not fully configured, skipping email");
    return { success: false, error: "Email service not configured" };
  }

  return sendTemplateEmail(sendgridApiKey, fromEmail, email, templateId, {
    username: username,
  });
}

/**
 * Send a winner notification email
 */
export async function sendWinnerEmail(
  email: string,
  username: string,
  competitionName: string,
  prizeValue: string,
  winningTicket: string
): Promise<{ success: boolean; error?: string }> {
  const sendgridApiKey = Netlify.env.get("SENDGRID_API_KEY");
  const fromEmail = Netlify.env.get("SENDGRID_FROM_EMAIL") || "contact@theprize.io";
  const templateId = Netlify.env.get("SENDGRID_TEMPLATE_WINNER");

  if (!sendgridApiKey || !templateId) {
    console.log("[sendWinnerEmail] SendGrid not fully configured, skipping email");
    return { success: false, error: "Email service not configured" };
  }

  return sendTemplateEmail(sendgridApiKey, fromEmail, email, templateId, {
    "Player Username": username,
    "Competition Name": competitionName,
    "Prize Value": prizeValue,
    "Winning Ticket": winningTicket,
  });
}

/**
 * Send a competition live notification email
 */
export async function sendCompLiveEmail(
  email: string,
  username: string,
  competitionName: string,
  prizeValue: string,
  endDate: string,
  ticketPrice: string
): Promise<{ success: boolean; error?: string }> {
  const sendgridApiKey = Netlify.env.get("SENDGRID_API_KEY");
  const fromEmail = Netlify.env.get("SENDGRID_FROM_EMAIL") || "contact@theprize.io";
  const templateId = Netlify.env.get("SENDGRID_TEMPLATE_COMP_LIVE");

  if (!sendgridApiKey || !templateId) {
    console.log("[sendCompLiveEmail] SendGrid not fully configured, skipping email");
    return { success: false, error: "Email service not configured" };
  }

  return sendTemplateEmail(sendgridApiKey, fromEmail, email, templateId, {
    "Player Username": username,
    "Competition Name": competitionName,
    "Prize Value": prizeValue,
    "End Date": endDate,
    "Ticket Price": ticketPrice,
  });
}

/**
 * Send FOMO weekly email to multiple users
 */
export async function sendFomoEmail(
  recipients: Array<{ email: string; username: string }>,
  activeCompetitions: string,
  totalPrizes: string
): Promise<{ success: boolean; sent: number; failed: number }> {
  const sendgridApiKey = Netlify.env.get("SENDGRID_API_KEY");
  const fromEmail = Netlify.env.get("SENDGRID_FROM_EMAIL") || "contact@theprize.io";
  const templateId = Netlify.env.get("SENDGRID_TEMPLATE_FOMO");

  if (!sendgridApiKey || !templateId) {
    console.log("[sendFomoEmail] SendGrid not fully configured, skipping email");
    return { success: false, sent: 0, failed: recipients.length };
  }

  let sent = 0;
  let failed = 0;

  // Send in batches to avoid rate limits (SendGrid allows up to 1000 per request)
  const batchSize = 100;
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);

    // For FOMO emails, we need to personalize per user
    const personalizations = batch.map((recipient) => ({
      to: [{ email: recipient.email }],
      dynamic_template_data: {
        "Player Username": recipient.username,
        "Active Competitions": activeCompetitions,
        "Total Prizes": totalPrizes,
      },
    }));

    try {
      const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sendgridApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations,
          from: { email: fromEmail, name: "ThePrize.io" },
          template_id: templateId,
        }),
      });

      if (response.ok) {
        sent += batch.length;
      } else {
        const errorText = await response.text();
        console.error(`[sendFomoEmail] Batch failed:`, errorText);
        failed += batch.length;
      }
    } catch (error) {
      console.error(`[sendFomoEmail] Batch error:`, error);
      failed += batch.length;
    }
  }

  return { success: sent > 0, sent, failed };
}
