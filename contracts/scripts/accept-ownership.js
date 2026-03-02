/**
 * Accept VRF Contract Ownership
 *
 * This is step 2 of the ownership transfer process.
 * The new owner must run this script to accept ownership.
 *
 * Prerequisites:
 * 1. transfer-ownership.js has been run by the current owner
 * 2. DEPLOYER_PRIVATE_KEY is set to the NEW owner's private key
 *
 * Run: cd contracts && npx hardhat run scripts/accept-ownership.js --network base
 */

const hre = require("hardhat");

// ThePrizeVRF Contract Address on Base Mainnet
const VRF_CONTRACT_ADDRESS = "0x8ce54644e3313934D663c43Aea29641DFD8BcA1A";

async function main() {
  const [signer] = await hre.ethers.getSigners();

  console.log("=== Accept VRF Ownership ===\n");
  console.log("Signer (new owner):", signer.address);
  console.log("VRF Contract:", VRF_CONTRACT_ADDRESS);
  console.log("");

  // ABI for ownership functions (from ConfirmedOwner)
  const ownershipAbi = [
    "function owner() external view returns (address)",
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

  if (currentOwner.toLowerCase() === signer.address.toLowerCase()) {
    console.log("\n✅ You are already the contract owner!");
    return;
  }

  // Accept ownership
  console.log("\nAccepting ownership...");
  const acceptTx = await vrfContract.acceptOwnership();
  console.log("Transaction hash:", acceptTx.hash);

  const receipt = await acceptTx.wait();
  console.log("✅ Ownership accepted! Block:", receipt.blockNumber);

  // Verify new owner
  const newOwner = await vrfContract.owner();
  console.log("\nNew contract owner:", newOwner);

  if (newOwner.toLowerCase() === signer.address.toLowerCase()) {
    console.log("✅ SUCCESS! Ownership transfer complete!");
  } else {
    console.log("⚠️ WARNING: Ownership may not have transferred correctly.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
