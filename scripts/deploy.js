const hre = require("hardhat");

async function main() {
  console.log("Deploying contracts to Paseo Asset Hub...");

  // Deploy HatNFT contract first
  console.log("Deploying HatNFT contract...");
  const HatNFT = await hre.ethers.getContractFactory("HatNFT");
  const hatNFT = await HatNFT.deploy();
  await hatNFT.deployed();
  console.log("HatNFT deployed to:", hatNFT.address);

  // Deploy RewardsManager contract
  console.log("Deploying RewardsManager contract...");
  const RewardsManager = await hre.ethers.getContractFactory("RewardsManager");
  const rewardsManager = await RewardsManager.deploy();
  await rewardsManager.deployed();
  console.log("RewardsManager deployed to:", rewardsManager.address);

  // Deploy GameManager contract with HatNFT address
  console.log("Deploying GameManager contract...");
  const GameManager = await hre.ethers.getContractFactory("GameManager");
  const gameManager = await GameManager.deploy(hatNFT.address);
  await gameManager.deployed();
  console.log("GameManager deployed to:", gameManager.address);

  // Set GameManager reference in HatNFT contract
  console.log("Setting GameManager reference in HatNFT contract...");
  await hatNFT.setGameManager(gameManager.address);
  console.log("GameManager reference set in HatNFT contract");

  console.log("\n=== Deployment Summary ===");
  console.log("HatNFT (hat.sol):", hatNFT.address);
  console.log("GameManager (gameManager.sol):", gameManager.address);
  console.log("RewardsManager (RewardsManager.sol):", rewardsManager.address);

  console.log("\n=== Next Steps ===");
  console.log("1. Update your PolkaGodot config with these contract addresses:");
  console.log("   nft_contract_address =", hatNFT.address);
  console.log("   marketplace_contract_address =", gameManager.address);
  console.log("   registry_contract_address =", rewardsManager.address);
  console.log("2. Verify contracts on block explorer:");
  console.log("   https://blockscout-passet-hub.parity-testnet.parity.io");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });