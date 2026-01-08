import React, { useState } from "react";
import { X } from "lucide-react";
import { useAuthUser } from "../contexts/AuthContext";

interface EmailVerifyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EmailVerifyModal: React.FC<EmailVerifyModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { login } = useAuthUser();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleStart = async () => {
    setError(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setError("Please enter a valid email.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-auth-start`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
          },
          body: JSON.stringify({ email: trimmed }),
        }
      );

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Could not send code");
      }

      setSessionId(json.sessionId);
      setStep("code");
    } catch (err: unknown) {
      console.error("[EmailVerifyModal] start error", err);
      const errorMessage = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setError(null);
    if (!sessionId) {
      setError("Verification session missing. Please restart.");
      setStep("email");
      return;
    }
    if (!code.trim()) {
      setError("Please enter the 6-digit code.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-auth-verify`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
          },
          body: JSON.stringify({ sessionId, code: code.trim() }),
        }
      );

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Invalid or expired code");
      }

      // Email is verified in our system
      // Close this modal and trigger the auth modal for wallet connection
      onClose();

      // Trigger the login flow which will open the BaseWalletAuthModal
      // The login function dispatches an event that Header listens for
      login();
    } catch (err: unknown) {
      console.error("[EmailVerifyModal] verify error", err);
      const errorMessage = err instanceof Error ? err.message : "Verification failed. Please try again.";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70">
      <div className="bg-[#101010] border border-white/10 rounded-2xl p-6 w-full max-w-md relative">
        <button
          className="absolute right-4 top-4 text-white/60 hover:text-white"
          onClick={onClose}
        >
          <X size={18} />
        </button>

        {step === "email" && (
          <>
            <h2 className="text-xl font-semibold text-white mb-3">
              Start with your email
            </h2>
            <p className="text-sm text-white/70 mb-4">
              We'll send a 6-digit code to verify your email before you connect
              your wallet or create your ThePrize.io account.
            </p>

            <input
              type="email"
              className="w-full rounded-lg border border-white/10 bg-black/40 text-white px-3 py-2 text-sm mb-3"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />

            {error && (
              <p className="text-xs text-red-400 mb-2">
                {error}
              </p>
            )}

            <div className="mt-2">
              <button
                onClick={handleStart}
                disabled={loading}
                className="w-full bg-[#DDE404] text-black font-semibold uppercase text-xs rounded-md py-2 hover:bg-[#d1db04] disabled:opacity-60"
              >
                {loading ? "Sending code..." : "Send verification code"}
              </button>
            </div>
          </>
        )}

        {step === "code" && (
          <>
            <h2 className="text-xl font-semibold text-white mb-3">
              Enter your verification code
            </h2>
            <p className="text-sm text-white/70 mb-4">
              We sent a 6-digit code to{" "}
              <span className="font-semibold text-[#DDE404]">{email}</span>.
              Enter it below to continue.
            </p>

            <input
              type="text"
              maxLength={6}
              className="w-full rounded-lg border border-white/10 bg-black/40 text-white px-3 py-2 text-sm mb-3 tracking-[0.35em] text-center"
              placeholder="------"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              disabled={loading}
            />

            {error && (
              <p className="text-xs text-red-400 mb-2">
                {error}
              </p>
            )}

            <div className="flex flex-col gap-2 mt-2">
              <button
                onClick={handleVerify}
                disabled={loading}
                className="w-full bg-[#DDE404] text-black font-semibold uppercase text-xs rounded-md py-2 hover:bg-[#d1db04] disabled:opacity-60"
              >
                {loading ? "Verifying..." : "Verify & open sign up"}
              </button>

              <button
                type="button"
                onClick={() => setStep("email")}
                className="w-full border border-white/20 text-white text-xs rounded-md py-2 hover:bg-white/5"
                disabled={loading}
              >
                Go back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default EmailVerifyModal;
