/**
 * Revoke EIP-7702 Delegation
 * Signs revocation authorization and bundles with gas payment
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

// Compromised wallet
const COMPROMISED_PRIVATE_KEY =
  "0xbbd7b4c81cadd561f24646259bf6cce08ed1d95e7be762473c5d372733338138";
// New admin wallet (to pay gas)
const FUNDER_PRIVATE_KEY =
  "0xa147b55dafc4ec8e5f59940fb11db95fa52c71f775aa729932cb778116479d6b";

async function main() {
  console.log("=== EIP-7702 Revocation ===\n");

  const publicClient = createPublicClient({
    chain: base,
    transport: http(),
  });

  const compromisedAccount = privateKeyToAccount(COMPROMISED_PRIVATE_KEY);
  const funderAccount = privateKeyToAccount(FUNDER_PRIVATE_KEY);

  console.log("Compromised wallet:", compromisedAccount.address);
  console.log("Funder wallet:", funderAccount.address);

  // Check current delegation
  const currentCode = await publicClient.getCode({
    address: compromisedAccount.address,
  });
  console.log("\nCurrent code:", currentCode);

  if (!currentCode || !currentCode.startsWith("0xef0100")) {
    console.log("No EIP-7702 delegation found - wallet is clean!");
    return;
  }

  const delegatedTo = "0x" + currentCode.slice(8);
  console.log("Currently delegated to:", delegatedTo);

  // Check funder balance
  const funderBalance = await publicClient.getBalance({
    address: funderAccount.address,
  });
  console.log("\nFunder wallet balance:", funderBalance.toString(), "wei");

  if (funderBalance < parseEther("0.0005")) {
    console.log("❌ Funder needs at least 0.0005 ETH for gas");
    return;
  }

  // Create wallet client for funder
  const funderClient = createWalletClient({
    account: funderAccount,
    chain: base,
    transport: http(),
  });

  // Sign authorization to revoke (delegate to address(0))
  console.log("\n--- Signing revocation authorization ---");

  const nonce = await publicClient.getTransactionCount({
    address: compromisedAccount.address,
  });

  // Create authorization object
  const authorization = await compromisedAccount.signAuthorization({
    contractAddress: "0x0000000000000000000000000000000000000000",
    chainId: base.id,
    nonce: nonce,
  });

  console.log("Authorization signed!");

  // Send transaction with authorization list
  console.log("\n--- Sending revocation transaction ---");

  const hash = await funderClient.sendTransaction({
    to: compromisedAccount.address,
    value: 0n,
    authorizationList: [authorization],
  });

  console.log("Transaction hash:", hash);
  console.log("Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("✅ Confirmed! Block:", receipt.blockNumber);

  // Verify revocation
  const newCode = await publicClient.getCode({
    address: compromisedAccount.address,
  });
  console.log("\nNew code:", newCode || "None (clean!)");

  if (!newCode || newCode === "0x") {
    console.log("\n🎉 SUCCESS! EIP-7702 delegation revoked!");
  } else {
    console.log("\n⚠️ Code still present - may need different approach");
  }
}

main().catch(console.error);
