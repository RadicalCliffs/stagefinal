/**
 * VRF Ownership Transfer Script (Ownable2Step)
 *
 * This script transfers VRF contract ownership using the 2-step pattern.
 * The old wallet has an EIP-7702 drainer - we race against it.
 *
 * USAGE:
 *   1. Create a NEW wallet in MetaMask (or hardware wallet)
 *   2. Fund it with ~0.005 ETH on Base
 *   3. Set environment variables:
 *      $env:OLD_PRIVATE_KEY = "0x..."  (compromised wallet)
 *      $env:NEW_PRIVATE_KEY = "0x..."  (your new wallet)
 *   4. Run: node scripts/transfer_ownership_2step.cjs
 */

const {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { base } = require("viem/chains");

const VRF_CONTRACT = "0xc5Dfc3f6a227B30161f53F0BC167495158854854";
const RPC = "https://mainnet.base.org";

// Function selectors
const TRANSFER_OWNERSHIP = "0xf2fde38b"; // transferOwnership(address)
const ACCEPT_OWNERSHIP = "0x79ba5097"; // acceptOwnership()

async function main() {
  const oldPk = process.env.OLD_PRIVATE_KEY;
  const newPk = process.env.NEW_PRIVATE_KEY;

  if (!oldPk || !newPk) {
    console.log("ERROR: Set environment variables first!\n");
    console.log("PowerShell:");
    console.log('  $env:OLD_PRIVATE_KEY = "0xYourOldKey"');
    console.log('  $env:NEW_PRIVATE_KEY = "0xYourNewKey"');
    console.log("  node scripts/transfer_ownership_2step.cjs");
    process.exit(1);
  }

  const oldAccount = privateKeyToAccount(oldPk);
  const newAccount = privateKeyToAccount(newPk);

  console.log("=== VRF OWNERSHIP TRANSFER (2-STEP) ===\n");
  console.log("Old wallet (compromised):", oldAccount.address);
  console.log("New wallet:", newAccount.address);
  console.log("VRF Contract:", VRF_CONTRACT);
  console.log("");

  const pub = createPublicClient({ chain: base, transport: http(RPC) });

  const oldWallet = createWalletClient({
    chain: base,
    transport: http(RPC),
    account: oldAccount,
  });

  const newWallet = createWalletClient({
    chain: base,
    transport: http(RPC),
    account: newAccount,
  });

  // Check current owner
  const ownerData = await pub.call({
    to: VRF_CONTRACT,
    data: "0x8da5cb5b", // owner()
  });
  const currentOwner = "0x" + ownerData.data.slice(26);
  console.log("Current VRF owner:", currentOwner);

  if (currentOwner.toLowerCase() !== oldAccount.address.toLowerCase()) {
    console.log("\nERROR: Old wallet is NOT the current owner!");
    console.log("Someone may have already transferred ownership.");
    process.exit(1);
  }

  // Check balances
  const oldBal = await pub.getBalance({ address: oldAccount.address });
  const newBal = await pub.getBalance({ address: newAccount.address });

  console.log("\nOld wallet ETH:", (Number(oldBal) / 1e18).toFixed(6));
  console.log("New wallet ETH:", (Number(newBal) / 1e18).toFixed(6));

  const minRequired = parseEther("0.002");
  if (newBal < minRequired) {
    console.log("\nERROR: New wallet needs at least 0.002 ETH for gas!");
    console.log("Send some ETH to:", newAccount.address);
    process.exit(1);
  }

  // STEP 0: Fund old wallet (just enough for gas - drainer will race us)
  const gasAmount = parseEther("0.0008"); // ~0.0008 ETH for gas

  console.log("\n=== STEP 0: Funding old wallet ===");
  console.log(
    "Sending",
    (Number(gasAmount) / 1e18).toFixed(6),
    "ETH to old wallet...",
  );
  console.log("(Racing against drainer!)");

  const fundTx = await newWallet.sendTransaction({
    to: oldAccount.address,
    value: gasAmount,
  });
  console.log("Fund tx:", fundTx);

  // DON'T WAIT - immediately send transferOwnership
  console.log("\n=== STEP 1: transferOwnership (RACING!) ===");

  // Encode transferOwnership(newAddress)
  const transferData =
    TRANSFER_OWNERSHIP + newAccount.address.slice(2).padStart(64, "0");

  const fee = await pub.estimateFeesPerGas();
  const nonce = await pub.getTransactionCount({
    address: oldAccount.address,
    blockTag: "pending",
  });

  try {
    const transferTx = await oldWallet.sendTransaction({
      to: VRF_CONTRACT,
      data: transferData,
      gas: 100000n,
      nonce,
      maxFeePerGas: fee.maxFeePerGas * 2n, // 2x gas price to prioritize
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas * 2n,
    });
    console.log("Transfer ownership tx:", transferTx);

    // Wait for it
    console.log("Waiting for confirmation...");
    const receipt = await pub.waitForTransactionReceipt({ hash: transferTx });

    if (receipt.status === "success") {
      console.log("SUCCESS! Ownership transfer initiated.");
    } else {
      console.log("FAILED! Transaction reverted.");
      console.log("The drainer may have been faster. Check wallet balance.");
      process.exit(1);
    }
  } catch (err) {
    console.log("ERROR:", err.message);
    console.log("\nThe drainer likely stole the ETH before we could use it.");
    console.log("Try again with more ETH or faster timing.");
    process.exit(1);
  }

  // STEP 2: Accept ownership from new wallet
  console.log("\n=== STEP 2: acceptOwnership ===");

  const acceptTx = await newWallet.sendTransaction({
    to: VRF_CONTRACT,
    data: ACCEPT_OWNERSHIP,
    gas: 50000n,
  });
  console.log("Accept ownership tx:", acceptTx);

  const acceptReceipt = await pub.waitForTransactionReceipt({ hash: acceptTx });

  if (acceptReceipt.status === "success") {
    console.log("\n=== SUCCESS! ===");
    console.log("Ownership transferred to:", newAccount.address);
    console.log("\nNEXT STEPS:");
    console.log("1. Update Supabase secrets:");
    console.log(
      "   supabase secrets set ADMIN_WALLET_PRIVATE_KEY=" +
        newPk.slice(0, 10) +
        "...",
    );
    console.log("2. Verify new owner on BaseScan");
  } else {
    console.log("Accept ownership FAILED!");
  }

  // Verify final owner
  const finalOwnerData = await pub.call({
    to: VRF_CONTRACT,
    data: "0x8da5cb5b",
  });
  const finalOwner = "0x" + finalOwnerData.data.slice(26);
  console.log("\nFinal VRF owner:", finalOwner);
}

main().catch(console.error);
