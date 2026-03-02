/**
 * Transfer VRF Ownership - Standalone Script
 * Uses viem directly without hardhat
 *
 * Run from project root: node contracts/scripts/transfer-ownership-standalone.mjs
 */

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// Configuration
const VRF_CONTRACT_ADDRESS = "0x8ce54644e3313934D663c43Aea29641DFD8BcA1A";
const NEW_OWNER_ADDRESS = "0x8cE9AF17F552B387FD46Cf8C29DE4Df38FEF2bc3";
const CURRENT_OWNER_PRIVATE_KEY =
  "0x808f9fb7f4403682c288e5c5556c57773940e0d826dc38e7cbe8da02a69e5784";
const NEW_OWNER_PRIVATE_KEY =
  "0xa147b55dafc4ec8e5f59940fb11db95fa52c71f775aa729932cb778116479d6b";

// ABI for ownership functions (from ConfirmedOwner)
const OWNERSHIP_ABI = [
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    name: "transferOwnership",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }],
    outputs: [],
  },
  {
    name: "acceptOwnership",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
];

async function main() {
  console.log("=== VRF Ownership Transfer ===\n");

  // Create public client for reading
  const publicClient = createPublicClient({
    chain: base,
    transport: http(),
  });

  // Current owner account
  const currentOwnerAccount = privateKeyToAccount(CURRENT_OWNER_PRIVATE_KEY);
  console.log("Current owner wallet:", currentOwnerAccount.address);

  // New owner account
  const newOwnerAccount = privateKeyToAccount(NEW_OWNER_PRIVATE_KEY);
  console.log("New owner wallet:", newOwnerAccount.address);
  console.log("VRF Contract:", VRF_CONTRACT_ADDRESS);
  console.log("");

  // Check current owner
  const contractOwner = await publicClient.readContract({
    address: VRF_CONTRACT_ADDRESS,
    abi: OWNERSHIP_ABI,
    functionName: "owner",
  });
  console.log("Current contract owner:", contractOwner);

  if (contractOwner.toLowerCase() === NEW_OWNER_ADDRESS.toLowerCase()) {
    console.log("\n✅ New owner is already the contract owner!");
    return;
  }

  if (
    contractOwner.toLowerCase() !== currentOwnerAccount.address.toLowerCase()
  ) {
    console.log(
      "\n❌ ERROR: Current owner private key doesn't match contract owner!",
    );
    console.log("   Contract owner:", contractOwner);
    console.log("   Wallet address:", currentOwnerAccount.address);
    return;
  }

  // Create wallet client for current owner
  const currentOwnerClient = createWalletClient({
    account: currentOwnerAccount,
    chain: base,
    transport: http(),
  });

  // Step 1: Transfer ownership (current owner initiates)
  console.log("\n--- Step 1: Initiating ownership transfer ---");
  const transferHash = await currentOwnerClient.writeContract({
    address: VRF_CONTRACT_ADDRESS,
    abi: OWNERSHIP_ABI,
    functionName: "transferOwnership",
    args: [NEW_OWNER_ADDRESS],
  });
  console.log("Transaction hash:", transferHash);
  console.log("Waiting for confirmation...");

  const transferReceipt = await publicClient.waitForTransactionReceipt({
    hash: transferHash,
  });
  console.log("✅ Transfer initiated! Block:", transferReceipt.blockNumber);

  // Step 2: Accept ownership (new owner accepts)
  console.log("\n--- Step 2: Accepting ownership ---");
  const newOwnerClient = createWalletClient({
    account: newOwnerAccount,
    chain: base,
    transport: http(),
  });

  const acceptHash = await newOwnerClient.writeContract({
    address: VRF_CONTRACT_ADDRESS,
    abi: OWNERSHIP_ABI,
    functionName: "acceptOwnership",
    args: [],
  });
  console.log("Transaction hash:", acceptHash);
  console.log("Waiting for confirmation...");

  const acceptReceipt = await publicClient.waitForTransactionReceipt({
    hash: acceptHash,
  });
  console.log("✅ Ownership accepted! Block:", acceptReceipt.blockNumber);

  // Verify new owner
  const newContractOwner = await publicClient.readContract({
    address: VRF_CONTRACT_ADDRESS,
    abi: OWNERSHIP_ABI,
    functionName: "owner",
  });
  console.log("\n--- Verification ---");
  console.log("New contract owner:", newContractOwner);

  if (newContractOwner.toLowerCase() === NEW_OWNER_ADDRESS.toLowerCase()) {
    console.log(
      "\n🎉 SUCCESS! VRF ownership transferred to:",
      NEW_OWNER_ADDRESS,
    );
  } else {
    console.log("\n⚠️ WARNING: Ownership may not have transferred correctly.");
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
