/**
 * Deploy ThePrizeVRF using Coinbase CDP Wallet
 *
 * This uses Coinbase's MPC wallet - no private key exposure!
 *
 * Prerequisites:
 * 1. Create CDP API keys at https://portal.cdp.coinbase.com/
 * 2. Set environment variables:
 *    - CDP_API_KEY_NAME
 *    - CDP_API_KEY_PRIVATE_KEY
 * 3. Fund the wallet with ~0.02 ETH on Base
 *
 * Run: node scripts/deploy_with_cdp.cjs
 */

const { CdpClient } = require("@coinbase/cdp-sdk");
const {
  createPublicClient,
  http,
  parseEther,
  encodeFunctionData,
} = require("viem");
const { base } = require("viem/chains");
const dotenv = require("dotenv");

dotenv.config();

// Base Mainnet VRF V2.5 Coordinator
const VRF_COORDINATOR = "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634";
const RPC = "https://mainnet.base.org";

// ThePrizeVRF bytecode - will be generated after compilation
// For now, we'll use the existing contract's interface
const COORDINATOR_ABI = [
  "function createSubscription() external returns (uint256 subId)",
  "function addConsumer(uint256 subId, address consumer) external",
  "function fundSubscriptionWithNative(uint256 subId) external payable",
  "function getSubscription(uint256 subId) external view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] memory consumers)",
];

async function main() {
  console.log("=== ThePrizeVRF Deployment with Coinbase CDP ===\n");

  // Initialize CDP client
  const cdp = new CdpClient();

  // Create a new EVM account (MPC wallet)
  console.log("Creating CDP wallet...");
  const account = await cdp.evm.createAccount({ networkId: "base-mainnet" });
  console.log("Wallet address:", account.address);

  // Check balance
  const pub = createPublicClient({ chain: base, transport: http(RPC) });
  const balance = await pub.getBalance({ address: account.address });
  console.log("Balance:", (Number(balance) / 1e18).toFixed(6), "ETH\n");

  if (balance < parseEther("0.015")) {
    console.log("ERROR: Insufficient balance!");
    console.log("Please send at least 0.02 ETH to:", account.address);
    console.log(
      "\nYou can use Coinbase to send ETH to this address on Base network.",
    );
    console.log("\nAfter funding, run this script again.");

    // Save account info for later
    const fs = require("fs");
    fs.writeFileSync(
      "cdp_account.json",
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
    console.log("\nAccount info saved to cdp_account.json");
    return;
  }

  // Step 1: Create VRF Subscription
  console.log("Step 1: Creating VRF Subscription...");

  const createSubData = encodeFunctionData({
    abi: [
      {
        name: "createSubscription",
        type: "function",
        inputs: [],
        outputs: [{ type: "uint256" }],
      },
    ],
    functionName: "createSubscription",
  });

  const createTx = await cdp.evm.sendTransaction({
    address: account.address,
    to: VRF_COORDINATOR,
    data: createSubData,
    networkId: "base-mainnet",
  });

  console.log("Create subscription tx:", createTx.transactionHash);

  // Wait for confirmation and get subscription ID
  const createReceipt = await pub.waitForTransactionReceipt({
    hash: createTx.transactionHash,
  });

  // Parse subscription ID from event
  const subCreatedTopic =
    "0x464722b4166576d3dcbba877b999bc35cf911f4eaf434b7eba68fa113951d0bf"; // SubscriptionCreated
  const subEvent = createReceipt.logs.find(
    (log) => log.topics[0] === subCreatedTopic,
  );
  const subscriptionId = BigInt(subEvent.topics[1]);

  console.log("Subscription ID:", subscriptionId.toString());

  // Step 2: Fund subscription
  console.log("\nStep 2: Funding subscription with 0.005 ETH...");

  const fundData = encodeFunctionData({
    abi: [
      {
        name: "fundSubscriptionWithNative",
        type: "function",
        inputs: [{ name: "subId", type: "uint256" }],
        outputs: [],
      },
    ],
    functionName: "fundSubscriptionWithNative",
    args: [subscriptionId],
  });

  const fundTx = await cdp.evm.sendTransaction({
    address: account.address,
    to: VRF_COORDINATOR,
    data: fundData,
    value: parseEther("0.005").toString(),
    networkId: "base-mainnet",
  });

  await pub.waitForTransactionReceipt({ hash: fundTx.transactionHash });
  console.log("Funded!");

  // Step 3: Deploy contract
  // NOTE: You'll need to compile the contract and get the bytecode first
  // Using hardhat: npx hardhat compile
  // Then read from artifacts/contracts/ThePrizeVRF.sol/ThePrizeVRF.json

  console.log("\nStep 3: Deploy contract...");
  console.log("NOTE: Contract deployment requires compiled bytecode.");
  console.log("Run: cd contracts && npm install && npx hardhat compile");
  console.log("Then update this script with the bytecode from:");
  console.log(
    "  contracts/artifacts/contracts/ThePrizeVRF.sol/ThePrizeVRF.json",
  );

  // Save deployment state
  const fs = require("fs");
  fs.writeFileSync(
    "cdp_deployment_state.json",
    JSON.stringify(
      {
        walletAddress: account.address,
        subscriptionId: subscriptionId.toString(),
        vrfCoordinator: VRF_COORDINATOR,
        network: "base-mainnet",
        status: "subscription_created",
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log("\n" + "=".repeat(50));
  console.log("PARTIAL DEPLOYMENT COMPLETE");
  console.log("=".repeat(50));
  console.log("\nCDP Wallet:", account.address);
  console.log("Subscription ID:", subscriptionId.toString());
  console.log("\nState saved to cdp_deployment_state.json");
  console.log("\nNEXT: Compile contract and run deploy_contract_cdp.cjs");
}

main().catch(console.error);
