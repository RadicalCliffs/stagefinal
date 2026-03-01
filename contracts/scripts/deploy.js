/**
 * Deploy ThePrizeVRF Contract
 *
 * Prerequisites:
 * 1. Create a new wallet (MetaMask)
 * 2. Fund it with ~0.02 ETH on Base
 * 3. Set environment variables:
 *    - DEPLOYER_PRIVATE_KEY: Your new wallet's private key
 *    - BASESCAN_API_KEY: (optional) For contract verification
 *
 * Run: cd contracts && npx hardhat run scripts/deploy.js --network base
 */

const hre = require("hardhat");

// Base Mainnet VRF V2.5 Coordinator
const VRF_COORDINATOR = "0xd5D517aBE5cF79B7e95eC98dB0f0277788aFF634";

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("=== ThePrizeVRF Deployment ===\n");
  console.log("Deployer:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "ETH\n");

  if (balance < hre.ethers.parseEther("0.01")) {
    throw new Error("Insufficient balance. Need at least 0.01 ETH");
  }

  // Step 1: Create VRF Subscription
  console.log("Step 1: Creating VRF Subscription...");

  const coordinatorAbi = [
    "function createSubscription() external returns (uint256 subId)",
    "function addConsumer(uint256 subId, address consumer) external",
    "function fundSubscriptionWithNative(uint256 subId) external payable",
    "function getSubscription(uint256 subId) external view returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] memory consumers)",
  ];

  const coordinator = new hre.ethers.Contract(
    VRF_COORDINATOR,
    coordinatorAbi,
    deployer,
  );

  // Create subscription
  const createTx = await coordinator.createSubscription();
  const createReceipt = await createTx.wait();

  // Get subscription ID from event logs
  const subCreatedEvent = createReceipt.logs.find(
    (log) =>
      log.topics[0] === hre.ethers.id("SubscriptionCreated(uint256,address)"),
  );
  const subscriptionId = BigInt(subCreatedEvent.topics[1]);

  console.log("Subscription ID:", subscriptionId.toString());

  // Step 2: Fund subscription with native ETH
  console.log("\nStep 2: Funding subscription with 0.005 ETH...");

  const fundTx = await coordinator.fundSubscriptionWithNative(subscriptionId, {
    value: hre.ethers.parseEther("0.005"),
  });
  await fundTx.wait();
  console.log("Funded!");

  // Step 3: Deploy the VRF Consumer contract
  console.log("\nStep 3: Deploying ThePrizeVRF contract...");

  const ThePrizeVRF = await hre.ethers.getContractFactory("ThePrizeVRF");
  const vrfContract = await ThePrizeVRF.deploy(VRF_COORDINATOR, subscriptionId);
  await vrfContract.waitForDeployment();

  const contractAddress = await vrfContract.getAddress();
  console.log("Contract deployed at:", contractAddress);

  // Step 4: Add contract as consumer
  console.log("\nStep 4: Adding contract as VRF consumer...");

  const addConsumerTx = await coordinator.addConsumer(
    subscriptionId,
    contractAddress,
  );
  await addConsumerTx.wait();
  console.log("Consumer added!");

  // Step 5: Verify subscription status
  console.log("\nStep 5: Verifying setup...");

  const subInfo = await coordinator.getSubscription(subscriptionId);
  console.log(
    "Subscription balance:",
    hre.ethers.formatEther(subInfo.nativeBalance),
    "ETH",
  );
  console.log("Owner:", subInfo.owner);
  console.log("Consumers:", subInfo.consumers);

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("DEPLOYMENT COMPLETE!");
  console.log("=".repeat(50));
  console.log("\nVRF Contract:", contractAddress);
  console.log("Subscription ID:", subscriptionId.toString());
  console.log("Owner:", deployer.address);
  console.log("\nNEXT STEPS:");
  console.log("1. Update VRF_CONTRACT in your edge function:");
  console.log(`   const VRF_CONTRACT = "${contractAddress}" as const;`);
  console.log("\n2. Update Supabase secrets:");
  console.log("   supabase secrets set ADMIN_WALLET_PRIVATE_KEY=0x...");
  console.log("\n3. Verify contract on BaseScan (optional):");
  console.log(
    `   npx hardhat verify --network base ${contractAddress} ${VRF_COORDINATOR} ${subscriptionId}`,
  );

  // Save deployment info
  const fs = require("fs");
  const deploymentInfo = {
    network: "base",
    chainId: 8453,
    contractAddress,
    subscriptionId: subscriptionId.toString(),
    vrfCoordinator: VRF_COORDINATOR,
    owner: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync("deployment.json", JSON.stringify(deploymentInfo, null, 2));
  console.log("\nDeployment info saved to deployment.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
