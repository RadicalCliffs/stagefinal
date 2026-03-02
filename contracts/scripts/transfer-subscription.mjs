/**
 * Transfer Chainlink VRF Subscription Ownership
 *
 * Run from project root: node contracts/scripts/transfer-subscription.mjs
 */

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// Configuration
const VRF_COORDINATOR_ADDRESS = "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634";
const NEW_OWNER_ADDRESS = "0x8cE9AF17F552B387FD46Cf8C29DE4Df38FEF2bc3";
const CURRENT_OWNER_PRIVATE_KEY =
  "0xbbd7b4c81cadd561f24646259bf6cce08ed1d95e7be762473c5d372733338138";
const NEW_OWNER_PRIVATE_KEY =
  "0xa147b55dafc4ec8e5f59940fb11db95fa52c71f775aa729932cb778116479d6b";

// VRF Coordinator ABI (subscription management functions)
const VRF_COORDINATOR_ABI = [
  {
    name: "getSubscription",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "subId", type: "uint256" }],
    outputs: [
      { name: "balance", type: "uint96" },
      { name: "nativeBalance", type: "uint96" },
      { name: "reqCount", type: "uint64" },
      { name: "owner", type: "address" },
      { name: "consumers", type: "address[]" },
    ],
  },
  {
    name: "requestSubscriptionOwnerTransfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "subId", type: "uint256" },
      { name: "newOwner", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "acceptSubscriptionOwnerTransfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "subId", type: "uint256" }],
    outputs: [],
  },
];

async function main() {
  console.log("=== Chainlink VRF Subscription Transfer ===\n");

  const publicClient = createPublicClient({
    chain: base,
    transport: http(),
  });

  // Current owner account
  const currentOwnerAccount = privateKeyToAccount(CURRENT_OWNER_PRIVATE_KEY);
  console.log("Current subscription owner:", currentOwnerAccount.address);

  // New owner account
  const newOwnerAccount = privateKeyToAccount(NEW_OWNER_PRIVATE_KEY);
  console.log("New subscription owner:", newOwnerAccount.address);
  console.log("VRF Coordinator:", VRF_COORDINATOR_ADDRESS);

  // Get subscription ID from command line or use default
  const subId = process.argv[2] ? BigInt(process.argv[2]) : null;

  if (!subId) {
    console.log("\n❌ ERROR: Please provide subscription ID as argument");
    console.log(
      "Usage: node contracts/scripts/transfer-subscription.mjs <SUBSCRIPTION_ID>",
    );
    console.log(
      "\nYou can find your subscription ID at https://vrf.chain.link",
    );
    return;
  }

  console.log("Subscription ID:", subId.toString());
  console.log("");

  // Check current subscription owner
  try {
    const subInfo = await publicClient.readContract({
      address: VRF_COORDINATOR_ADDRESS,
      abi: VRF_COORDINATOR_ABI,
      functionName: "getSubscription",
      args: [subId],
    });

    console.log("Current subscription details:");
    console.log("  Owner:", subInfo[3]);
    console.log("  Native Balance:", subInfo[1].toString(), "wei");
    console.log("  Consumers:", subInfo[4].length);

    if (subInfo[3].toLowerCase() === NEW_OWNER_ADDRESS.toLowerCase()) {
      console.log("\n✅ New owner is already the subscription owner!");
      return;
    }

    if (
      subInfo[3].toLowerCase() !== currentOwnerAccount.address.toLowerCase()
    ) {
      console.log(
        "\n❌ ERROR: Current owner private key doesn't match subscription owner!",
      );
      console.log("   Subscription owner:", subInfo[3]);
      console.log("   Your wallet:", currentOwnerAccount.address);
      return;
    }
  } catch (e) {
    console.log("Error fetching subscription:", e.message);
    return;
  }

  // Create wallet client for current owner
  const currentOwnerClient = createWalletClient({
    account: currentOwnerAccount,
    chain: base,
    transport: http(),
  });

  // Step 1: Request transfer
  console.log("\n--- Step 1: Requesting subscription transfer ---");
  const requestHash = await currentOwnerClient.writeContract({
    address: VRF_COORDINATOR_ADDRESS,
    abi: VRF_COORDINATOR_ABI,
    functionName: "requestSubscriptionOwnerTransfer",
    args: [subId, NEW_OWNER_ADDRESS],
  });
  console.log("Transaction hash:", requestHash);
  console.log("Waiting for confirmation...");

  const requestReceipt = await publicClient.waitForTransactionReceipt({
    hash: requestHash,
  });
  console.log("✅ Transfer requested! Block:", requestReceipt.blockNumber);

  // Step 2: Accept transfer
  console.log("\n--- Step 2: Accepting subscription transfer ---");
  const newOwnerClient = createWalletClient({
    account: newOwnerAccount,
    chain: base,
    transport: http(),
  });

  const acceptHash = await newOwnerClient.writeContract({
    address: VRF_COORDINATOR_ADDRESS,
    abi: VRF_COORDINATOR_ABI,
    functionName: "acceptSubscriptionOwnerTransfer",
    args: [subId],
  });
  console.log("Transaction hash:", acceptHash);
  console.log("Waiting for confirmation...");

  const acceptReceipt = await publicClient.waitForTransactionReceipt({
    hash: acceptHash,
  });
  console.log("✅ Transfer accepted! Block:", acceptReceipt.blockNumber);

  // Verify
  const newSubInfo = await publicClient.readContract({
    address: VRF_COORDINATOR_ADDRESS,
    abi: VRF_COORDINATOR_ABI,
    functionName: "getSubscription",
    args: [subId],
  });

  console.log("\n--- Verification ---");
  console.log("New subscription owner:", newSubInfo[3]);

  if (newSubInfo[3].toLowerCase() === NEW_OWNER_ADDRESS.toLowerCase()) {
    console.log(
      "\n🎉 SUCCESS! Subscription transferred to:",
      NEW_OWNER_ADDRESS,
    );
  } else {
    console.log("\n⚠️ WARNING: Transfer may not have completed correctly.");
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
