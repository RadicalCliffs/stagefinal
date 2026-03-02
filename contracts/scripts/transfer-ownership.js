/**
 * Transfer VRF Contract Ownership
 *
 * This script transfers ownership of ThePrizeVRF contract from the current admin
 * to a new admin wallet.
 *
 * VRFConsumerBaseV2Plus inherits from ConfirmedOwner which requires two steps:
 * 1. Current owner calls transferOwnership(newOwner)
 * 2. New owner calls acceptOwnership()
 *
 * Run: cd contracts && npx hardhat run scripts/transfer-ownership.js --network base
 */

const hre = require("hardhat");

// ThePrizeVRF Contract Address on Base Mainnet
const VRF_CONTRACT_ADDRESS = "0x8ce54644e3313934D663c43Aea29641DFD8BcA1A";

// New admin wallet address
const NEW_OWNER_ADDRESS = "0x8cE9AF17F552B387FD46Cf8C29DE4Df38FEF2bc3";

async function main() {
  const [signer] = await hre.ethers.getSigners();

  console.log("=== VRF Ownership Transfer ===\n");
  console.log("Current signer:", signer.address);
  console.log("VRF Contract:", VRF_CONTRACT_ADDRESS);
  console.log("New Owner:", NEW_OWNER_ADDRESS);
  console.log("");

  // ABI for ownership functions (from ConfirmedOwner)
  const ownershipAbi = [
    "function owner() external view returns (address)",
    "function transferOwnership(address to) external",
    "function acceptOwnership() external",
  ];

  const vrfContract = new hre.ethers.Contract(
    VRF_CONTRACT_ADDRESS,
    ownershipAbi,
    signer,
  );

  // Check current owner
  const currentOwner = await vrfContract.owner();
  console.log("Current contract owner:", currentOwner);

  if (currentOwner.toLowerCase() === NEW_OWNER_ADDRESS.toLowerCase()) {
    console.log("\n✅ New owner is already the contract owner!");
    return;
  }

  if (currentOwner.toLowerCase() !== signer.address.toLowerCase()) {
    console.log("\n❌ ERROR: You are not the current owner!");
    console.log("   Current owner:", currentOwner);
    console.log("   Your address:", signer.address);
    console.log("\n   You need the private key of:", currentOwner);
    return;
  }

  // Step 1: Transfer ownership
  console.log("\nStep 1: Initiating ownership transfer...");
  const transferTx = await vrfContract.transferOwnership(NEW_OWNER_ADDRESS);
  console.log("Transaction hash:", transferTx.hash);

  const receipt = await transferTx.wait();
  console.log("✅ Transfer initiated! Block:", receipt.blockNumber);

  console.log("\n=== IMPORTANT ===");
  console.log("Ownership transfer has been INITIATED but NOT completed!");
  console.log(
    "The new owner must call acceptOwnership() to complete the transfer.",
  );
  console.log("\nTo complete the transfer, run:");
  console.log("  npx hardhat run scripts/accept-ownership.js --network base");
  console.log("  (using the new owner's private key as DEPLOYER_PRIVATE_KEY)");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
