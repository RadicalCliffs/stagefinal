import type { Context, Config } from "@netlify/functions";
import { CdpClient } from "@coinbase/cdp-sdk";
import { parseEther, parseUnits, createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";

/**
 * CDP Transfer Function - Coinbase Developer Platform SDK Integration
 *
 * ARCHITECTURE NOTE - CDP Embedded Wallets vs Server Wallets:
 * ============================================================
 * This application uses CDP EMBEDDED WALLETS for user funds, NOT server wallets.
 *
 * User Payment Architecture:
 * - Users authenticate via CDP React (@coinbase/cdp-react) which creates embedded wallets
 * - User USDC is stored in their embedded wallet, signed by their passkey/email
 * - Payments use user's wallet directly (via wagmi/OnchainKit) or Spend Permissions
 * - Treasury address receives payments but does NOT hold/manage user funds
 *
 * @deprecated The EOA/Smart Account transfer endpoints in this function are DEPRECATED
 * for user payment flows. They may be retained for:
 * - Testnet faucet operations (development only)
 * - Internal/admin operations
 * - Gas sponsorship via paymaster (future use)
 *
 * DO NOT use /api/cdp/transfer/* endpoints for user payments!
 * User USDC is in their embedded wallet, not in server-managed accounts.
 *
 * Routes:
 * - POST /api/cdp/transfer/evm - [DEPRECATED for payments] Transfer via EOA
 * - POST /api/cdp/transfer/smart-account - [DEPRECATED for payments] Transfer via Smart Account
 * - POST /api/cdp/accounts - Get or create EVM accounts (internal use)
 * - POST /api/cdp/accounts/solana - Create Solana accounts (internal use)
 * - GET /api/cdp/accounts/:name - Get account by name (internal use)
 * - POST /api/cdp/faucet/evm - Request testnet ETH (Base Sepolia, dev only)
 * - POST /api/cdp/faucet/solana - Request devnet SOL (dev only)
 * - POST /api/cdp/send-transaction - [DEPRECATED for payments] Send EVM transaction
 */

// Check if we're using mainnet based on environment variable
function isMainnet(): boolean {
  return Netlify.env.get("VITE_BASE_MAINNET") === "true";
}

// Get the correct chain based on network
function getChain(networkId?: string) {
  // If explicit network provided, use it
  if (networkId === "base") return base;
  if (networkId === "base-sepolia") return baseSepolia;
  // Otherwise use environment variable to determine default
  return isMainnet() ? base : baseSepolia;
}

// Get the correct RPC URL based on network
function getRpcUrl(networkId?: string): string {
  const chain = getChain(networkId);
  if (chain.id === 8453) {
    return "https://mainnet.base.org";
  }
  return "https://sepolia.base.org";
}

// Create viem public client for the appropriate network
function getPublicClient(networkId?: string) {
  const chain = getChain(networkId);
  return createPublicClient({
    chain,
    transport: http(getRpcUrl(networkId)),
  });
}

// Default network ID based on environment
function getDefaultNetworkId(): string {
  return isMainnet() ? "base" : "base-sepolia";
}

// Get paymaster URL from environment
function getPaymasterUrl(): string | undefined {
  return Netlify.env.get("CDP_PAYMASTER_URL");
}

// Initialize CDP client - uses environment variables for API credentials
function getCdpClient(): CdpClient {
  // CDP SDK documentation states it reads from these env vars automatically:
  // CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET
  // But we also support legacy naming for backward compatibility

  // API Key ID - used for general CDP API authentication
  const apiKeyId = Netlify.env.get("CDP_API_KEY_ID") ||
                   Netlify.env.get("CDC_CLIENT_API_KEY") ||
                   Netlify.env.get("VITE_CDP_API_KEY");

  // API Key Secret - used with apiKeyId for CDP API authentication
  // Note: This is different from walletSecret
  const apiKeySecret = Netlify.env.get("CDP_API_KEY_SECRET") ||
                       Netlify.env.get("CDC_SECRET_API_KEY");

  // Wallet Secret - used for EVM/Solana account operations (transfer, sign, etc.)
  // This is the private key from CDP Portal
  const walletSecret = Netlify.env.get("CDP_WALLET_SECRET");

  const paymasterUrl = getPaymasterUrl();

  if (!apiKeyId) {
    throw new Error("Missing CDP API Key ID - set CDP_API_KEY_ID, CDC_CLIENT_API_KEY, or VITE_CDP_API_KEY environment variable");
  }

  // CDP SDK configuration
  // The SDK can work with either apiKeySecret or walletSecret depending on the operation
  //
  // NOTE: Server wallets (EVM accounts created here) are NOT used for user payments.
  // User funds are in CDP embedded wallets, created via cdp-react on the client.
  // This walletSecret is only needed for internal/admin operations and testnet faucets.
  const config: ConstructorParameters<typeof CdpClient>[0] = {
    apiKeyId,
  };

  // Add API key secret if available (for non-wallet operations)
  if (apiKeySecret) {
    config.apiKeySecret = apiKeySecret;
  }

  // Add wallet secret if available (required for EVM account operations)
  if (walletSecret) {
    config.walletSecret = walletSecret;
  }

  // Ensure we have at least one form of authentication for wallet operations
  if (!apiKeySecret && !walletSecret) {
    throw new Error("Missing CDP authentication - set either CDP_API_KEY_SECRET or CDP_WALLET_SECRET environment variable");
  }

  // Add paymaster configuration if available
  if (paymasterUrl) {
    config.paymasterUrl = paymasterUrl;
  }

  return new CdpClient(config);
}

// CORS headers for all responses
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, apikey",
  "Access-Control-Max-Age": "86400",
};

// Response helpers
function jsonResponse(data: object, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function errorResponse(message: string, status: number = 400): Response {
  return jsonResponse({ success: false, error: message }, status);
}

// Validate CDP account name format
// CDP requires: alphanumeric characters and hyphens, between 2 and 36 characters
function validateAccountName(name: string): { valid: boolean; error?: string } {
  if (!name || typeof name !== "string") {
    return { valid: false, error: "Account name is required and must be a string" };
  }

  const trimmed = name.trim();

  if (trimmed.length < 2 || trimmed.length > 36) {
    return {
      valid: false,
      error: `Account name must be between 2 and 36 characters long (got ${trimmed.length} characters)`,
    };
  }

  // Only alphanumeric characters and hyphens allowed
  const validPattern = /^[a-zA-Z0-9-]+$/;
  if (!validPattern.test(trimmed)) {
    return {
      valid: false,
      error: "Account name must contain only alphanumeric characters and hyphens (e.g., my-account-name)",
    };
  }

  return { valid: true };
}

// Token configurations for different networks
// USDC and WETH have the same addresses on both Base Mainnet and Base Sepolia
const TOKEN_CONFIGS = {
  mainnet: {
    eth: { decimals: 18 },
    usdc: { decimals: 6, address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }, // USDC on Base Mainnet
    weth: { decimals: 18, address: "0x4200000000000000000000000000000000000006" }, // WETH on Base Mainnet
  },
  testnet: {
    eth: { decimals: 18 },
    usdc: { decimals: 6, address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" }, // USDC on Base Sepolia
    weth: { decimals: 18, address: "0x4200000000000000000000000000000000000006" }, // WETH on Base Sepolia
  },
};

// Get token config based on network
function getTokenConfig(networkId?: string): Record<string, { decimals: number; address?: string }> {
  const useMainnet = networkId === "base" || (networkId !== "base-sepolia" && isMainnet());
  return useMainnet ? TOKEN_CONFIGS.mainnet : TOKEN_CONFIGS.testnet;
}

// Parse amount based on token type
function parseTokenAmount(amount: string, token: string, networkId?: string): bigint {
  const tokenConfigs = getTokenConfig(networkId);
  const tokenConfig = tokenConfigs[token.toLowerCase()];
  if (!tokenConfig) {
    throw new Error(`Unsupported token: ${token}. Supported tokens: ${Object.keys(tokenConfigs).join(", ")}`);
  }

  if (token.toLowerCase() === "eth") {
    return parseEther(amount);
  }

  return parseUnits(amount, tokenConfig.decimals);
}

// Get token address (or "eth"/"usdc" for native tokens)
function getTokenIdentifier(token: string, networkId?: string): string {
  const tokenLower = token.toLowerCase();
  const tokenConfigs = getTokenConfig(networkId);
  const tokenConfig = tokenConfigs[tokenLower];

  if (!tokenConfig) {
    // If not a known token, assume it's a contract address
    if (token.startsWith("0x") && token.length === 42) {
      return token;
    }
    throw new Error(`Unsupported token: ${token}`);
  }

  // Return contract address if available, otherwise the token symbol
  return tokenConfig.address || tokenLower;
}

/**
 * Get or create an EVM account by name
 */
async function handleGetOrCreateAccount(
  body: Record<string, unknown>,
  cdp: CdpClient
): Promise<Response> {
  const { name } = body;

  // Validate account name format
  const nameValidation = validateAccountName(name as string);
  if (!nameValidation.valid) {
    return errorResponse(nameValidation.error!);
  }

  try {
    const account = await cdp.evm.getOrCreateAccount({ name: name as string });

    return jsonResponse({
      success: true,
      account: {
        address: account.address,
        name: name as string,
      },
    });
  } catch (error) {
    console.error("Error creating account:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to create account",
      500
    );
  }
}

/**
 * Create a Smart Account
 */
async function handleCreateSmartAccount(
  body: Record<string, unknown>,
  cdp: CdpClient
): Promise<Response> {
  const { ownerName } = body;

  // Validate owner account name format
  const nameValidation = validateAccountName(ownerName as string);
  if (!nameValidation.valid) {
    return errorResponse(nameValidation.error!);
  }

  try {
    // Get or create owner EOA
    const owner = await cdp.evm.getOrCreateAccount({ name: ownerName as string });

    // Create smart account with the owner
    const smartAccount = await cdp.evm.createSmartAccount({ owner });

    return jsonResponse({
      success: true,
      smartAccount: {
        address: smartAccount.address,
        ownerAddress: owner.address,
        ownerName,
      },
    });
  } catch (error) {
    console.error("Error creating smart account:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to create smart account",
      500
    );
  }
}

/**
 * Transfer tokens using an EOA (Externally Owned Account)
 */
async function handleEoaTransfer(
  body: Record<string, unknown>,
  cdp: CdpClient
): Promise<Response> {
  const { senderName, receiverAddress, amount, token, network } = body;

  // Validate sender account name format
  const nameValidation = validateAccountName(senderName as string);
  if (!nameValidation.valid) {
    return errorResponse(nameValidation.error!);
  }

  if (!receiverAddress || typeof receiverAddress !== "string") {
    return errorResponse("receiverAddress is required");
  }

  if (!amount || typeof amount !== "string") {
    return errorResponse("amount is required as a string");
  }

  const tokenType = (token as string) || "eth";
  // Use default network if not specified - respects VITE_BASE_MAINNET env var
  const networkId = (network as string) || getDefaultNetworkId();
  const publicClient = getPublicClient(networkId);
  const explorerBaseUrl = networkId === "base" ? "https://basescan.org" : "https://sepolia.basescan.org";

  try {
    // Get sender account
    const sender = await cdp.evm.getOrCreateAccount({ name: senderName as string });

    // Parse the amount with network-specific token config
    const parsedAmount = parseTokenAmount(amount, tokenType, networkId);
    const tokenIdentifier = getTokenIdentifier(tokenType, networkId);

    // Perform the transfer
    const { transactionHash } = await sender.transfer({
      to: receiverAddress,
      amount: parsedAmount,
      token: tokenIdentifier,
      network: networkId,
    });

    // Wait for transaction confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: transactionHash as `0x${string}`,
    });

    return jsonResponse({
      success: true,
      transfer: {
        transactionHash,
        status: receipt.status,
        from: sender.address,
        to: receiverAddress,
        amount,
        token: tokenType,
        network: networkId,
        blockNumber: Number(receipt.blockNumber),
        explorerUrl: `${explorerBaseUrl}/tx/${transactionHash}`,
      },
    });
  } catch (error) {
    console.error("EOA transfer error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Transfer failed",
      500
    );
  }
}

/**
 * Transfer tokens using a Smart Account (supports paymaster for gas sponsorship)
 */
async function handleSmartAccountTransfer(
  body: Record<string, unknown>,
  cdp: CdpClient
): Promise<Response> {
  const { ownerName, receiverAddress, amount, token, network } = body;

  // Validate owner account name format
  const nameValidation = validateAccountName(ownerName as string);
  if (!nameValidation.valid) {
    return errorResponse(nameValidation.error!);
  }

  if (!receiverAddress || typeof receiverAddress !== "string") {
    return errorResponse("receiverAddress is required");
  }

  if (!amount || typeof amount !== "string") {
    return errorResponse("amount is required as a string");
  }

  const tokenType = (token as string) || "eth";
  // Use default network if not specified - respects VITE_BASE_MAINNET env var
  const networkId = (network as string) || getDefaultNetworkId();
  const explorerBaseUrl = networkId === "base" ? "https://basescan.org" : "https://sepolia.basescan.org";

  try {
    // Get owner account
    const owner = await cdp.evm.getOrCreateAccount({ name: ownerName as string });

    // Create smart account
    const smartAccount = await cdp.evm.createSmartAccount({ owner });

    // Parse the amount with network-specific token config
    const parsedAmount = parseTokenAmount(amount, tokenType, networkId);
    const tokenIdentifier = getTokenIdentifier(tokenType, networkId);

    // Perform the transfer via smart account
    const { userOpHash } = await smartAccount.transfer({
      to: receiverAddress,
      amount: parsedAmount,
      token: tokenIdentifier,
      network: networkId,
    });

    // Wait for user operation confirmation
    const receipt = await smartAccount.waitForUserOperation({
      userOpHash,
    });

    return jsonResponse({
      success: true,
      transfer: {
        userOpHash,
        status: receipt.status,
        from: smartAccount.address,
        ownerAddress: owner.address,
        to: receiverAddress,
        amount,
        token: tokenType,
        network: networkId,
        explorerUrl: `${explorerBaseUrl}/address/${smartAccount.address}`,
      },
    });
  } catch (error) {
    console.error("Smart account transfer error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Transfer failed",
      500
    );
  }
}

/**
 * Get account information by name
 */
async function handleGetAccount(
  accountName: string,
  cdp: CdpClient
): Promise<Response> {
  // Validate account name format
  const nameValidation = validateAccountName(accountName);
  if (!nameValidation.valid) {
    return errorResponse(nameValidation.error!);
  }

  try {
    const account = await cdp.evm.getOrCreateAccount({ name: accountName });

    return jsonResponse({
      success: true,
      account: {
        address: account.address,
        name: accountName,
      },
    });
  } catch (error) {
    console.error("Get account error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to get account",
      500
    );
  }
}

/**
 * Create a Solana account
 */
async function handleCreateSolanaAccount(
  body: Record<string, unknown>,
  cdp: CdpClient
): Promise<Response> {
  const { name } = body;

  // Validate account name format if provided
  if (name) {
    const nameValidation = validateAccountName(name as string);
    if (!nameValidation.valid) {
      return errorResponse(nameValidation.error!);
    }
  }

  try {
    // Create Solana account - name is optional for identification
    const account = name
      ? await cdp.solana.getOrCreateAccount({ name: name as string })
      : await cdp.solana.createAccount();

    return jsonResponse({
      success: true,
      account: {
        address: account.address,
        name: name || null,
        network: "solana-devnet",
      },
    });
  } catch (error) {
    console.error("Error creating Solana account:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Failed to create Solana account",
      500
    );
  }
}

/**
 * Request testnet funds from EVM faucet (Base Sepolia)
 * Note: Faucet only works on testnet, not mainnet
 */
async function handleEvmFaucet(
  body: Record<string, unknown>,
  cdp: CdpClient
): Promise<Response> {
  const { address, network, token } = body;

  if (!address || typeof address !== "string") {
    return errorResponse("address is required");
  }

  // Faucet only works on testnet
  const networkId = (network as string) || "base-sepolia";
  const tokenType = (token as string) || "eth";
  const publicClient = getPublicClient(networkId);

  try {
    const faucetResponse = await cdp.evm.requestFaucet({
      address,
      network: networkId,
      token: tokenType,
    });

    // Wait for faucet transaction to be confirmed
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: faucetResponse.transactionHash as `0x${string}`,
    });

    return jsonResponse({
      success: true,
      faucet: {
        transactionHash: faucetResponse.transactionHash,
        status: receipt.status,
        address,
        token: tokenType,
        network: networkId,
        blockNumber: Number(receipt.blockNumber),
        explorerUrl: `https://sepolia.basescan.org/tx/${faucetResponse.transactionHash}`,
      },
    });
  } catch (error) {
    console.error("EVM faucet error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Faucet request failed",
      500
    );
  }
}

/**
 * Request devnet funds from Solana faucet
 */
async function handleSolanaFaucet(
  body: Record<string, unknown>,
  cdp: CdpClient
): Promise<Response> {
  const { address, token } = body;

  if (!address || typeof address !== "string") {
    return errorResponse("address is required");
  }

  const tokenType = (token as string) || "sol";

  try {
    const { signature } = await cdp.solana.requestFaucet({
      address,
      token: tokenType,
    });

    return jsonResponse({
      success: true,
      faucet: {
        signature,
        address,
        token: tokenType,
        network: "solana-devnet",
        explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
      },
    });
  } catch (error) {
    console.error("Solana faucet error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Faucet request failed",
      500
    );
  }
}

/**
 * Send an EVM transaction using Server Wallet
 */
async function handleSendTransaction(
  body: Record<string, unknown>,
  cdp: CdpClient
): Promise<Response> {
  const { address, transaction, network } = body;

  if (!address || typeof address !== "string") {
    return errorResponse("address is required");
  }

  if (!transaction || typeof transaction !== "object") {
    return errorResponse("transaction object is required");
  }

  // Use default network if not specified - respects VITE_BASE_MAINNET env var
  const networkId = (network as string) || getDefaultNetworkId();
  const publicClient = getPublicClient(networkId);
  const explorerBaseUrl = networkId === "base" ? "https://basescan.org" : "https://sepolia.basescan.org";
  const tx = transaction as { to: string; value?: string; data?: string };

  if (!tx.to || typeof tx.to !== "string") {
    return errorResponse("transaction.to is required");
  }

  try {
    // Parse value if provided (convert from ETH string to wei)
    let value: bigint | undefined;
    if (tx.value) {
      value = parseEther(tx.value);
    }

    const transactionResult = await cdp.evm.sendTransaction({
      address,
      transaction: {
        to: tx.to,
        value,
        data: tx.data as `0x${string}` | undefined,
      },
      network: networkId,
    });

    // Wait for transaction confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: transactionResult.transactionHash as `0x${string}`,
    });

    return jsonResponse({
      success: true,
      transaction: {
        transactionHash: transactionResult.transactionHash,
        status: receipt.status,
        from: address,
        to: tx.to,
        value: tx.value || "0",
        network: networkId,
        blockNumber: Number(receipt.blockNumber),
        explorerUrl: `${explorerBaseUrl}/tx/${transactionResult.transactionHash}`,
      },
    });
  } catch (error) {
    console.error("Send transaction error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Transaction failed",
      500
    );
  }
}

/**
 * Sign a Solana transaction
 */
async function handleSignSolanaTransaction(
  body: Record<string, unknown>,
  cdp: CdpClient
): Promise<Response> {
  const { address, transaction } = body;

  if (!address || typeof address !== "string") {
    return errorResponse("address is required");
  }

  if (!transaction || typeof transaction !== "string") {
    return errorResponse("transaction (base64 encoded) is required");
  }

  try {
    const { signature } = await cdp.solana.signTransaction({
      address,
      transaction,
    });

    return jsonResponse({
      success: true,
      signedTransaction: {
        signature,
        address,
      },
    });
  } catch (error) {
    console.error("Sign Solana transaction error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Transaction signing failed",
      500
    );
  }
}

// Main handler
export default async (req: Request, context: Context): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.replace("/api/cdp", "").split("/").filter(Boolean);
  const route = pathParts.join("/");

  try {
    const cdp = getCdpClient();

    // Handle GET requests
    if (req.method === "GET") {
      // GET /api/cdp/accounts/:name
      if (pathParts[0] === "accounts" && pathParts[1]) {
        return handleGetAccount(pathParts[1], cdp);
      }

      return errorResponse("Not found", 404);
    }

    // Handle POST requests
    if (req.method === "POST") {
      let body: Record<string, unknown> = {};
      try {
        body = await req.json();
      } catch {
        return errorResponse("Invalid JSON body");
      }

      switch (route) {
        case "accounts":
          return handleGetOrCreateAccount(body, cdp);

        case "accounts/smart":
          return handleCreateSmartAccount(body, cdp);

        case "accounts/solana":
          return handleCreateSolanaAccount(body, cdp);

        case "transfer/evm":
          return handleEoaTransfer(body, cdp);

        case "transfer/smart-account":
          return handleSmartAccountTransfer(body, cdp);

        case "faucet/evm":
          return handleEvmFaucet(body, cdp);

        case "faucet/solana":
          return handleSolanaFaucet(body, cdp);

        case "send-transaction":
          return handleSendTransaction(body, cdp);

        case "solana/sign-transaction":
          return handleSignSolanaTransaction(body, cdp);

        default:
          return errorResponse(`Unknown route: ${route}`, 404);
      }
    }

    return errorResponse("Method not allowed", 405);
  } catch (err) {
    console.error("CDP function error:", err);
    return errorResponse(
      err instanceof Error ? err.message : "Internal server error",
      500
    );
  }
};

export const config: Config = {
  path: "/api/cdp/*",
};
