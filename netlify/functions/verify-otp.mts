import type { Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export const config = {
  path: "/api/verify-otp",
};

interface VerifyRequest {
  email: string;
  code: string;
}

interface OtpRecord {
  code: string;
  email: string;
  createdAt: number;
  attempts: number;
}

const MAX_ATTEMPTS = 5;
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

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
    const body: VerifyRequest = await request.json();
    const { email, code } = body;

    if (!email || !code) {
      return new Response(
        JSON.stringify({ success: false, error: "Email and code are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate code format (6 digits)
    if (!/^\d{6}$/.test(code)) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid code format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const store = getStore("otp-codes");
    const otpKey = `otp:${email.toLowerCase()}`;

    // Retrieve OTP record
    const otpRecord = await store.get(otpKey, { type: "json" }) as OtpRecord | null;

    if (!otpRecord) {
      console.log(`[verify-otp][${requestId}] No OTP found for ${email}`);
      return new Response(
        JSON.stringify({ success: false, error: "No verification code found. Please request a new one." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check expiry
    const isExpired = Date.now() - otpRecord.createdAt > OTP_EXPIRY_MS;
    if (isExpired) {
      console.log(`[verify-otp][${requestId}] OTP expired for ${email}`);
      await store.delete(otpKey);
      return new Response(
        JSON.stringify({ success: false, error: "Verification code expired. Please request a new one." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check attempts
    if (otpRecord.attempts >= MAX_ATTEMPTS) {
      console.log(`[verify-otp][${requestId}] Too many attempts for ${email}`);
      await store.delete(otpKey);
      return new Response(
        JSON.stringify({ success: false, error: "Too many attempts. Please request a new code." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify code
    if (otpRecord.code !== code) {
      // Increment attempt count
      otpRecord.attempts += 1;
      await store.setJSON(otpKey, otpRecord);

      console.log(`[verify-otp][${requestId}] Invalid code attempt ${otpRecord.attempts}/${MAX_ATTEMPTS} for ${email}`);
      const remainingAttempts = MAX_ATTEMPTS - otpRecord.attempts;

      return new Response(
        JSON.stringify({
          success: false,
          error: `Invalid code. ${remainingAttempts} attempt${remainingAttempts !== 1 ? 's' : ''} remaining.`
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Success! Delete the OTP record
    await store.delete(otpKey);
    console.log(`[verify-otp][${requestId}] OTP verified successfully for ${email}`);

    return new Response(
      JSON.stringify({ success: true, message: "Email verified successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error(`[verify-otp][${requestId}] Error:`, error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
