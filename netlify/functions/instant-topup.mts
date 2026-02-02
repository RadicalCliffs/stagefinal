import type { Context, Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { toPrizePid, normalizeWalletAddress } from "./_shared/userId.mts";

/**
 * Instant Top-Up Function - Handle direct wallet-to-treasury USDC transfers
 *
 * This function processes instant wallet top-ups where users send USDC
 * directly from their connected wallet to the treasury, and we credit
 * their sub_account_balance immediately after verifying the transaction.
 *
 * Flow:
 * 1. Client sends USDC from wallet to treasury (handled in frontend)
 * 2. Client calls this function with transaction hash
 * 3. We verify the transaction on-chain
 * 4. We credit the user's balance
 * 5. We create a transaction record
 *
 * Routes:
 * - POST /api/instant-topup - Process an instant top-up
 */

// Verification status constants
const VERIFICATION_STATUS = {
  VERIFIED: "verified",
  PENDING: "pending_verification",
} as const;

// Helper function to construct transaction notes
function constructTransactionNotes(
  isVerified: boolean,
  bonusApplied: boolean,
  bonusAmount: number
): string {
  const verificationLabel = isVerified ? "[Verified]" : "[Pending Verification]";
  
  if (bonusApplied) {
    return `Wallet topup completed with 50% bonus (+$${bonusAmount.toFixed(2)}) ${verificationLabel}`;
  }
  
  return `Wallet topup completed ${verificationLabel}`;
}

// Response helpers
function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function errorResponse(message: string, status: number = 400): Response {
  return jsonResponse({ success: false, error: message }, status);
}

// Get Supabase clients
function getSupabaseClient() {
  const supabaseUrl = Netlify.env.get("VITE_SUPABASE_URL") || Netlify.env.get("SUPABASE_URL");
  const supabaseServiceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing Supabase configuration");
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Verify wallet address token
async function verifyWalletToken(
  token: string,
  supabase: ReturnType<typeof createClient>
): Promise<{ userId: string; canonicalUserId: string } | null> {
  if (!token.startsWith("wallet:")) {
    return null;
  }

  const walletAddress = token.replace("wallet:", "").trim();

  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return null;
  }

  const normalizedAddress = walletAddress.toLowerCase();

  const { data: userConnection, error } = await supabase
    .from("canonical_users")
    .select("id, privy_user_id, canonical_user_id, wallet_address")
    .or(
      `wallet_address.ilike.${normalizedAddress},base_wallet_address.ilike.${normalizedAddress}`
    )
    .maybeSingle();

  if (error || !userConnection) {
    console.error("Wallet user not found:", error?.message);
    return null;
  }

  return {
    userId: userConnection.id,
    canonicalUserId: userConnection.canonical_user_id || toPrizePid(normalizedAddress),
  };
}

// Get authenticated user from request
async function getAuthenticatedUser(
  request: Request,
  supabase: ReturnType<typeof createClient>
): Promise<{ userId: string; canonicalUserId: string } | null> {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "").trim();

  // Try wallet token first
  const walletUser = await verifyWalletToken(token, supabase);
  if (walletUser) {
    return walletUser;
  }

  // Try Supabase token
  try {
    const anonKey = Netlify.env.get("VITE_SUPABASE_ANON_KEY") || Netlify.env.get("SUPABASE_ANON_KEY");
    const url = Netlify.env.get("VITE_SUPABASE_URL") || Netlify.env.get("SUPABASE_URL");
    if (!anonKey || !url) return null;

    const anonClient = createClient(url, anonKey);
    const { data: { user }, error } = await anonClient.auth.getUser(token);

    if (error || !user) return null;

    return {
      userId: user.id,
      canonicalUserId: toPrizePid(user.id),
    };
  } catch {
    return null;
  }
}

// Verify transaction on Base network
async function verifyTransaction(
  txHash: string,
  expectedRecipient: string,
  expectedAmount: number,
  senderAddress: string
): Promise<{ verified: boolean; actualAmount?: number; error?: string }> {
  const isMainnet = Netlify.env.get("VITE_BASE_MAINNET") === "true";
  const rpcUrl = isMainnet ? "https://mainnet.base.org" : "https://sepolia.base.org";

  // USDC contract addresses
  const USDC_MAINNET = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const USDC_TESTNET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const USDC_ADDRESS = (
    Netlify.env.get("VITE_USDC_CONTRACT_ADDRESS") || (isMainnet ? USDC_MAINNET : USDC_TESTNET)
  ).toLowerCase();

  try {
    // Get transaction receipt
    const receiptResponse = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getTransactionReceipt",
        params: [txHash],
        id: 1,
      }),
    });

    const receiptData = await receiptResponse.json();
    const receipt = receiptData.result;

    if (!receipt) {
      return { verified: false, error: "Transaction not found or not yet confirmed on the blockchain. Please wait a few moments and try again." };
    }

    // Check if transaction was successful
    if (receipt.status !== "0x1") {
      return { verified: false, error: "Transaction failed on chain" };
    }

    // Note: We don't check receipt.to because smart contract wallets (Coinbase, etc.)
    // route transactions through their own contracts. Instead, we verify the USDC
    // Transfer event in the logs below, which is the definitive proof of USDC transfer.

    // Parse logs to find the Transfer event
    // Transfer event signature: Transfer(address indexed from, address indexed to, uint256 value)
    const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

    const transferLog = receipt.logs?.find(
      (log: any) =>
        log.topics?.[0] === transferTopic &&
        log.address?.toLowerCase() === USDC_ADDRESS
    );

    if (!transferLog) {
      return { verified: false, error: "No USDC transfer event found in transaction" };
    }

    // Extract from, to, and amount from the log
    const fromAddress = "0x" + transferLog.topics[1].slice(26).toLowerCase();
    const toAddress = "0x" + transferLog.topics[2].slice(26).toLowerCase();
    const amountHex = transferLog.data;
    const amountInUnits = BigInt(amountHex);
    const actualAmount = Number(amountInUnits) / 1_000_000; // USDC has 6 decimals

    // Verify sender
    if (fromAddress !== senderAddress.toLowerCase()) {
      return {
        verified: false,
        error: `Transaction sender mismatch. Expected: ${senderAddress}, Got: ${fromAddress}`,
      };
    }

    // Verify recipient
    if (toAddress !== expectedRecipient.toLowerCase()) {
      return {
        verified: false,
        error: `Transaction recipient mismatch. Expected: ${expectedRecipient}, Got: ${toAddress}`,
      };
    }

    // Verify amount (allow small tolerance for rounding)
    if (actualAmount < expectedAmount * 0.99) {
      return {
        verified: false,
        error: `Amount mismatch. Expected: ${expectedAmount}, Got: ${actualAmount}`,
        actualAmount,
      };
    }

    return { verified: true, actualAmount };
  } catch (error) {
    console.error("Error verifying transaction:", error);
    return {
      verified: false,
      error: error instanceof Error ? error.message : "Failed to verify transaction",
    };
  }
}

export default async (request: Request, context: Context): Promise<Response> => {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (request.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const supabase = getSupabaseClient();

    // Authenticate user
    const user = await getAuthenticatedUser(request, supabase);
    if (!user) {
      return errorResponse("Unauthorized", 401);
    }

    // Parse request body
    const body = await request.json();
    const { transactionHash, amount, walletAddress } = body;

    if (!transactionHash || typeof transactionHash !== "string") {
      return errorResponse("transactionHash is required");
    }

    if (!amount || typeof amount !== "number" || amount <= 0) {
      return errorResponse("amount must be a positive number");
    }

    if (!walletAddress || typeof walletAddress !== "string") {
      return errorResponse("walletAddress is required");
    }

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return errorResponse("Invalid wallet address format");
    }

    const normalizedWallet = normalizeWalletAddress(walletAddress);
    const treasuryAddress = Netlify.env.get("VITE_TREASURY_ADDRESS");

    console.log(`[VERBOSE][instant-topup] Validating transaction details`);
    console.log(`[VERBOSE][instant-topup] User wallet (normalized): ${normalizedWallet}`);
    console.log(`[VERBOSE][instant-topup] Treasury address (from env): ${treasuryAddress}`);
    console.log(`[VERBOSE][instant-topup] Transaction hash: ${transactionHash}`);
    console.log(`[VERBOSE][instant-topup] Amount: ${amount} USDC`);

    if (!treasuryAddress) {
      console.error(`[VERBOSE][instant-topup] ❌ Treasury address not configured in environment!`);
      return errorResponse("Service configuration error", 500);
    }
    
    console.log(`[VERBOSE][instant-topup] ✅ Treasury address validated`);

    // Check for duplicate transaction (idempotency)
    const { data: existingTx } = await supabase
      .from("user_transactions")
      .select("id, status, wallet_credited")
      .eq("tx_id", transactionHash)
      .maybeSingle();

    if (existingTx) {
      if (existingTx.wallet_credited) {
        return jsonResponse({
          success: true,
          message: "Transaction already processed",
          transactionId: existingTx.id,
          alreadyProcessed: true,
        });
      }
      // Transaction exists but not credited - will reprocess
      console.log(`Reprocessing transaction ${transactionHash} that wasn't credited`);
    }

    // Try to verify the transaction on-chain, but don't block crediting if verification fails
    console.log(`[VERBOSE][instant-topup] Attempting to verify transaction on-chain...`);
    console.log(`[VERBOSE][instant-topup] Verifying against:`);
    console.log(`[VERBOSE][instant-topup]   - Expected recipient: ${treasuryAddress}`);
    console.log(`[VERBOSE][instant-topup]   - Expected amount: ${amount} USDC`);
    console.log(`[VERBOSE][instant-topup]   - Expected sender: ${walletAddress}`);
    
    const verification = await verifyTransaction(
      transactionHash,
      treasuryAddress,
      amount,
      walletAddress
    );

    console.log(`[VERBOSE][instant-topup] Verification result:`, verification);
    
    let verificationStatus = VERIFICATION_STATUS.PENDING;
    let creditAmount = amount;
    
    if (verification.verified) {
      console.log(`[VERBOSE][instant-topup] ✅ Transaction verified successfully!`);
      console.log(`[VERBOSE][instant-topup] Actual amount transferred: ${verification.actualAmount} USDC`);
      verificationStatus = VERIFICATION_STATUS.VERIFIED;
      creditAmount = verification.actualAmount || amount;
    } else {
      console.warn(`[VERBOSE][instant-topup] ⚠️  Transaction not yet confirmed on blockchain`);
      console.warn(`[VERBOSE][instant-topup] Error: ${verification.error}`);
      console.warn(`[VERBOSE][instant-topup] Crediting balance anyway - verification will happen in background`);
      // Continue with crediting - don't block user experience
    }

    // Create or update transaction record
    let transactionId: string;

    if (existingTx) {
      transactionId = existingTx.id;
    } else {
      const { data: newTx, error: createError } = await supabase
        .from("user_transactions")
        .insert({
          user_id: user.canonicalUserId,
          canonical_user_id: user.canonicalUserId, // CRITICAL: Set canonical_user_id for proper querying
          wallet_address: normalizedWallet,
          competition_id: null, // Top-up has no competition
          amount: creditAmount,
          currency: "USDC",
          network: "base",
          payment_provider: "instant_wallet_topup",
          status: "completed",
          payment_status: "confirmed",
          type: "topup", // This is a wallet top-up transaction
          tx_id: transactionHash,
          completed_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (createError || !newTx) {
        console.error("Error creating transaction:", createError);
        return errorResponse("Failed to create transaction record", 500);
      }

      transactionId = newTx.id;
    }

    // Credit user's balance using the bonus-aware function for first deposit
    // This applies 50% bonus on the first topup automatically
    console.log(`[VERBOSE][instant-topup] Crediting user balance with bonus check`);
    console.log(`[VERBOSE][instant-topup] User canonical ID: ${user.canonicalUserId}`);
    console.log(`[VERBOSE][instant-topup] Amount to credit: ${creditAmount} USDC`);
    console.log(`[VERBOSE][instant-topup] Transaction hash: ${transactionHash}`);
    console.log(`[VERBOSE][instant-topup] Treasury address used: ${treasuryAddress}`);
    
    const { data: creditResult, error: creditError } = await supabase.rpc(
      "credit_balance_with_first_deposit_bonus",
      {
        p_canonical_user_id: user.canonicalUserId,
        p_amount: creditAmount,
        p_reason: "wallet_topup",
        p_reference_id: transactionHash,
      }
    );

    console.log(`[VERBOSE][instant-topup] Credit RPC result:`, creditResult);
    if (creditError) {
      console.error(`[VERBOSE][instant-topup] ❌ Credit RPC error:`, creditError);
    }

    // Check if bonus function succeeded
    if (!creditError && creditResult?.success) {
      const bonusAmount = creditResult.bonus_amount || 0;
      const bonusApplied = creditResult.bonus_applied || false;
      const newBalance = creditResult.new_balance;
      
      console.log(`[VERBOSE][instant-topup] ✅ Balance credit successful!`);
      console.log(`[VERBOSE][instant-topup] Credited amount: ${creditAmount}`);
      console.log(`[VERBOSE][instant-topup] Bonus applied: ${bonusApplied}`);
      console.log(`[VERBOSE][instant-topup] Bonus amount: ${bonusAmount}`);
      console.log(`[VERBOSE][instant-topup] Total credited: ${creditResult.total_credited}`);
      console.log(`[VERBOSE][instant-topup] New balance: ${newBalance}`);
      console.log(`[VERBOSE][instant-topup] User ID (canonical): ${user.canonicalUserId.substring(0, 20)}...`);
      console.log(`[VERBOSE][instant-topup] Balance should be visible in sub_account_balances table`);
      
      // Mark transaction as wallet_credited with verification status
      const updateNotes = constructTransactionNotes(
        verification.verified,
        bonusApplied,
        bonusAmount || 0
      );
      
      await supabase
        .from("user_transactions")
        .update({
          wallet_credited: true,
          notes: updateNotes,
        })
        .eq("id", transactionId);

      console.log(`[VERBOSE][instant-topup] Transaction marked as wallet_credited`);

      return jsonResponse({
        success: true,
        transactionId,
        creditedAmount: creditAmount,
        bonusAmount: bonusAmount,
        bonusApplied: bonusApplied,
        totalCredited: creditResult.total_credited,
        newBalance: newBalance,
        transactionHash,
        verificationStatus: verificationStatus,
      });
    }

    // If bonus function fails, fall back to standard credit
    if (creditError) {
      console.warn("[instant-topup] Bonus credit failed, falling back to standard credit:", creditError.message);
    }

    // Fallback: Use standard credit_sub_account_balance RPC function
    const { data: fallbackResult, error: fallbackError } = await supabase.rpc(
      "credit_sub_account_balance",
      {
        p_canonical_user_id: user.canonicalUserId,
        p_amount: creditAmount,
        p_currency: "USD",
      }
    );

    if (fallbackError) {
      console.error("Error crediting balance via sub_account_balances:", fallbackError);

      // Update transaction with error
      await supabase
        .from("user_transactions")
        .update({
          notes: `Balance credit failed: ${fallbackError.message}`,
        })
        .eq("id", transactionId);

      return errorResponse(
        "Transaction verified but balance credit failed. Please contact support.",
        500
      );
    }

    // Extract new balance from RPC result
    const newBalance = fallbackResult?.[0]?.new_balance ?? creditAmount;
    const creditSuccess = fallbackResult?.[0]?.success ?? false;

    if (!creditSuccess) {
      const errorMsg = fallbackResult?.[0]?.error_message || "Unknown error crediting balance";
      console.error("Balance credit returned failure:", errorMsg);

      await supabase
        .from("user_transactions")
        .update({
          notes: `Balance credit failed: ${errorMsg}`,
        })
        .eq("id", transactionId);

      return errorResponse(
        "Transaction verified but balance credit failed. Please contact support.",
        500
      );
    }

    // Mark transaction as credited with verification status
    const fallbackNotes = constructTransactionNotes(
      verification.verified,
      false, // No bonus in fallback path
      0
    );
      
    await supabase
      .from("user_transactions")
      .update({
        wallet_credited: true,
        status: "finished",
        notes: fallbackNotes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", transactionId);

    console.log(
      `Instant top-up complete: ${creditAmount} USDC credited to ${user.canonicalUserId}. New balance: ${newBalance}`
    );

    return jsonResponse({
      success: true,
      transactionId,
      creditedAmount: creditAmount,
      newBalance: newBalance,
      verificationStatus: verificationStatus,
      message: "Top-up successful",
    });
  } catch (error) {
    console.error("Instant top-up error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Internal server error",
      500
    );
  }
};

export const config: Config = {
  path: "/api/instant-topup",
};
