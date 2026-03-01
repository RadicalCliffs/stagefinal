/**
 * Create a new CDP wallet for VRF deployment
 *
 * Coinbase CDP provides MPC wallets - no private key to leak!
 *
 * Setup:
 * 1. Get CDP API keys from https://portal.cdp.coinbase.com/
 * 2. Create .env file with:
 *    - CDP_API_KEY_ID (your API key ID)
 *    - CDP_API_KEY_SECRET (your API key secret)
 *    - CDP_WALLET_SECRET (for wallet operations)
 * 3. Run: node scripts/create_cdp_wallet.mjs
 * 4. Fund the wallet with 0.02 ETH on Base
 */

import { CdpClient } from "@coinbase/cdp-sdk";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

// Map your env vars to CDP expected format
const cdp = new CdpClient({
  apiKeyId: process.env.CDP_API_KEY_ID || process.env.CDP_PROJECT_ID,
  apiKeySecret:
    process.env.CDP_API_KEY_SECRET || process.env.CDP_API_KEY_PRIVATE_KEY,
  walletSecret: process.env.CDP_WALLET_SECRET,
});

console.log("=== Creating CDP Wallet for ThePrize VRF ===\n");

// Create EVM account on Base
const account = await cdp.evm.createAccount({ networkId: "base-mainnet" });

console.log("CDP Wallet Created!");
console.log("Address:", account.address);
console.log("Network: Base Mainnet");
console.log("");
console.log("NEXT STEPS:");
console.log("1. Fund this address with ~0.02 ETH on Base");
console.log("2. Run: node scripts/deploy_vrf_cdp.mjs");

// Save account info
fs.writeFileSync(
  "cdp_wallet.json",
  JSON.stringify(
    {
      address: account.address,
      networkId: "base-mainnet",
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

console.log("\nWallet info saved to cdp_wallet.json");
