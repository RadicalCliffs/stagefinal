/**
 * Transfer VRF Ownership - SAFE VERSION
 *
 * USAGE:
 *   1. Run without args to GENERATE YOUR OWN new wallet
 *   2. Fund the new wallet with ~0.003 ETH
 *   3. Run with your keys:
 *      OLD_PRIVATE_KEY=0x... NEW_PRIVATE_KEY=0x... node scripts/transfer_vrf_ownership.cjs
 *
 * NEVER USE SOMEONE ELSE'S GENERATED KEYS - GENERATE YOUR OWN!
 */

const {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
} = require("viem");
const { privateKeyToAccount, generatePrivateKey } = require("viem/accounts");
const { base } = require("viem/chains");

const VRF_CONTRACT = "0xc5Dfc3f6a227B30161f53F0BC167495158854854";

const TRANSFER_OWNERSHIP_ABI = [
  {
    name: "transferOwnership",
    type: "function",
    inputs: [{ name: "newOwner", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
];

async function main() {
  const OLD_PRIVATE_KEY = process.env.OLD_PRIVATE_KEY;
  const NEW_PRIVATE_KEY = process.env.NEW_PRIVATE_KEY;

  // If no keys provided, generate a new wallet
  if (!OLD_PRIVATE_KEY || !NEW_PRIVATE_KEY) {
    console.log("=== GENERATE YOUR OWN NEW WALLET ===\n");

    const pk = generatePrivateKey();
    const acc = privateKeyToAccount(pk);

    console.log(
      "╔══════════════════════════════════════════════════════════════════╗",
    );
    console.log(
      "║  NEW WALLET GENERATED - SAVE THIS SECURELY!                      ║",
    );
    console.log(
      "╠══════════════════════════════════════════════════════════════════╣",
    );
    console.log("║  Address:", acc.address, "  ║");
    console.log(
      "║  Private Key:",
      pk.slice(0, 20) + "..." + pk.slice(-8),
      "             ║",
    );
    console.log(
      "╚══════════════════════════════════════════════════════════════════╝",
    );
    console.log("");
    console.log("Full Private Key (KEEP SECRET):");
    console.log(pk);
    console.log("");
    console.log("NEXT STEPS:");
    console.log(
      "1. Save the private key somewhere SAFE (password manager, hardware wallet)",
    );
    console.log("2. Send ~0.003 ETH to:", acc.address);
    console.log(
      "3. Run this command (replace YOUR_OLD_KEY with your compromised wallet key):",
    );
    console.log("");
    console.log(
      '   $env:OLD_PRIVATE_KEY="YOUR_OLD_KEY"; $env:NEW_PRIVATE_KEY="' +
        pk +
        '"; node scripts/transfer_vrf_ownership.cjs',
    );
    console.log("");
    return;
  }

  // Derive accounts from keys
  const oldAccount = privateKeyToAccount(OLD_PRIVATE_KEY);
  const newAccount = privateKeyToAccount(NEW_PRIVATE_KEY);
  const OLD_WALLET = oldAccount.address;
  const NEW_WALLET = newAccount.address;

  console.log("=== VRF OWNERSHIP TRANSFER ===\n");
  console.log("Old (compromised) wallet:", OLD_WALLET);
  console.log("New (clean) wallet:", NEW_WALLET);
  console.log("VRF Contract:", VRF_CONTRACT);
  console.log("");

  const pub = createPublicClient({
    chain: base,
    transport: http("https://mainnet.base.org"),
  });

  // Verify current owner
  const ownerData = await pub.call({
    to: VRF_CONTRACT,
    data: "0x8da5cb5b", // owner()
  });
  const currentOwner = "0x" + ownerData.data.slice(-40);
  console.log("Current VRF owner:", currentOwner);

  if (currentOwner.toLowerCase() !== OLD_WALLET.toLowerCase()) {
    console.error("ERROR: Old wallet is NOT the current owner!");
    console.error("Expected:", OLD_WALLET.toLowerCase());
    console.error("Got:", currentOwner.toLowerCase());
    process.exit(1);
  }
  console.log("✓ Ownership verified\n");

  // Check balances
  const oldBalance = await pub.getBalance({ address: OLD_WALLET });
  const newBalance = await pub.getBalance({ address: NEW_WALLET });

  console.log("Old wallet ETH:", (Number(oldBalance) / 1e18).toFixed(6));
  console.log("New wallet ETH:", (Number(newBalance) / 1e18).toFixed(6));

  if (newBalance === 0n) {
    console.error("\n❌ New wallet has 0 ETH! Cannot proceed.");
    console.error("Send ~0.003 ETH to:", NEW_WALLET);
    process.exit(1);
  }

  // Estimate gas requirements
  const fees = await pub.estimateFeesPerGas();
  const gasLimit = 100000n;
  const ethForGas = gasLimit * fees.maxFeePerGas * 2n; // 2x buffer for safety

  console.log("\nGas needed:", (Number(ethForGas) / 1e18).toFixed(6), "ETH");

  if (newBalance < ethForGas + 21000n * fees.maxFeePerGas) {
    console.error("❌ Insufficient ETH in new wallet");
    console.error(
      "Need at least:",
      (Number(ethForGas + 42000n * fees.maxFeePerGas) / 1e18).toFixed(6),
      "ETH",
    );
    process.exit(1);
  }

  // Get nonces
  const oldNonce = await pub.getTransactionCount({ address: OLD_WALLET });
  const newNonce = await pub.getTransactionCount({ address: NEW_WALLET });

  // Encode the transferOwnership call
  const transferData = encodeFunctionData({
    abi: TRANSFER_OWNERSHIP_ABI,
    functionName: "transferOwnership",
    args: [NEW_WALLET],
  });

  console.log("\n=== EXECUTING TRANSFER ===");
  console.log("TX1: Send gas ETH from new wallet to old wallet");
  console.log("TX2: Transfer ownership from old wallet to new wallet");
  console.log("");

  const newWalletClient = createWalletClient({
    chain: base,
    transport: http("https://mainnet.base.org"),
    account: newAccount,
  });

  const oldWalletClient = createWalletClient({
    chain: base,
    transport: http("https://mainnet.base.org"),
    account: oldAccount,
  });

  try {
    // TX1: Send ETH to old wallet for gas
    console.log(
      "Sending",
      (Number(ethForGas) / 1e18).toFixed(6),
      "ETH to old wallet...",
    );

    const tx1Hash = await newWalletClient.sendTransaction({
      to: OLD_WALLET,
      value: ethForGas,
      gas: 21000n,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
    console.log("TX1 submitted:", tx1Hash);

    // IMMEDIATELY submit TX2 without waiting
    console.log("Immediately submitting transferOwnership...");

    const tx2Hash = await oldWalletClient.sendTransaction({
      to: VRF_CONTRACT,
      data: transferData,
      gas: gasLimit,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      nonce: oldNonce,
    });
    console.log("TX2 submitted:", tx2Hash);

    // Wait for both
    console.log("\nWaiting for confirmations...");

    const [receipt1, receipt2] = await Promise.all([
      pub.waitForTransactionReceipt({ hash: tx1Hash }),
      pub.waitForTransactionReceipt({ hash: tx2Hash }),
    ]);

    console.log(
      "TX1 (send ETH):",
      receipt1.status === "success" ? "✓ Success" : "✗ Failed",
    );
    console.log(
      "TX2 (transfer ownership):",
      receipt2.status === "success" ? "✓ Success" : "✗ Failed",
    );

    // Verify new owner
    const newOwnerData = await pub.call({
      to: VRF_CONTRACT,
      data: "0x8da5cb5b",
    });
    const finalOwner = "0x" + newOwnerData.data.slice(-40);

    console.log("\n=== RESULT ===");
    console.log("VRF Contract Owner:", finalOwner);

    if (finalOwner.toLowerCase() === NEW_WALLET.toLowerCase()) {
      console.log("✅ SUCCESS! Ownership transferred to new wallet.");
      console.log("");
      console.log("NEXT: Update Supabase secrets:");
      console.log(
        "  supabase secrets set ADMIN_WALLET_PRIVATE_KEY=" + NEW_PRIVATE_KEY,
      );
    } else {
      console.log("❌ FAILED - Owner is not the new wallet");
      console.log(
        "The drainer may have stolen the ETH before we could use it.",
      );
    }
  } catch (error) {
    console.error("\n❌ Error:", error.message);

    if (error.message.includes("insufficient funds")) {
      console.log("\nThe drainer likely stole the ETH before we could use it.");
      console.log(
        "Try using Flashbots Protect RPC or a private transaction service.",
      );
    }
  }
}

main().catch(console.error);
