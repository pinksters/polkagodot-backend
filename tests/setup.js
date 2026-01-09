const { ethers } = require('ethers');
const path = require('path');
const fs = require('fs');
require('dotenv').config(); // Load .env from project root

// Load contract artifacts directly to avoid Hardhat build-info parsing issues with PolkaVM
function loadArtifact(contractPath, contractName) {
    const artifactPath = path.join(__dirname, '..', 'artifacts', contractPath, `${contractName}.json`);
    return JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
}

// Determine test network: 'local' (default) or 'paseo'
const TEST_NETWORK = process.env.TEST_NETWORK || 'local';
const IS_PASEO = TEST_NETWORK === 'paseo';

// Network configuration
const NETWORK_CONFIG = {
    local: {
        rpcUrl: 'http://127.0.0.1:8545',
        chainId: 31337,
        // Hardhat's default test accounts (10,000 ETH each)
        testPrivateKeys: [
            '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
            '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
            '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
            '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
        ],
    },
    paseo: {
        rpcUrl: 'https://testnet-passet-hub-eth-rpc.polkadot.io/',
        chainId: 420420422,
        // Uses PASEO_TEST_PRIVATE_KEY_1 through _4 from .env
        testPrivateKeys: [
            process.env.PASEO_TEST_PRIVATE_KEY_1,
            process.env.PASEO_TEST_PRIVATE_KEY_2,
            process.env.PASEO_TEST_PRIVATE_KEY_3,
            process.env.PASEO_TEST_PRIVATE_KEY_4,
        ].filter(Boolean).map(pk => pk.startsWith('0x') ? pk : `0x${pk}`),
    },
};

const config = NETWORK_CONFIG[TEST_NETWORK];
if (!config) {
    throw new Error(`Unknown TEST_NETWORK: ${TEST_NETWORK}. Use 'local' or 'paseo'.`);
}

if (IS_PASEO && config.testPrivateKeys.length === 0) {
    throw new Error('At least PASEO_TEST_PRIVATE_KEY_1 must be set in .env for Paseo tests');
}
if (IS_PASEO && config.testPrivateKeys.length < 4) {
    console.warn(`WARNING: Only ${config.testPrivateKeys.length} Paseo private keys configured. Some tests may fail.`);
}

// Test configuration - set BEFORE importing the server
process.env.PORT = '3003';
process.env.ADMIN_API_KEY = 'test-admin-key';
process.env.RPC_URL = config.rpcUrl;

let server;
let contracts = {};
let signers = [];

beforeAll(async () => {
    console.log(`Setting up test environment on ${TEST_NETWORK.toUpperCase()}...`);
    console.log(`RPC URL: ${config.rpcUrl}`);

    const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);

    // Verify connection
    try {
        const network = await provider.getNetwork();
        console.log(`Connected to network: chainId=${network.chainId}`);
        if (network.chainId !== config.chainId) {
            console.warn(`WARNING: Expected chainId ${config.chainId}, got ${network.chainId}`);
        }
    } catch (error) {
        const hint = IS_PASEO
            ? 'Check your internet connection and Paseo RPC endpoint'
            : 'Make sure to run: npx hardhat node';
        console.error(`ERROR: Cannot connect to ${TEST_NETWORK} network. ${hint}`);
        throw error;
    }

    // Setup deployer wallet
    const privateKey = config.testPrivateKeys[0];
    const deployer = new ethers.Wallet(privateKey, provider);

    // Check deployer balance
    const balance = await deployer.getBalance();
    console.log(`Deployer address: ${deployer.address}`);
    console.log(`Deployer balance: ${ethers.utils.formatEther(balance)} ETH`);

    if (balance.eq(0)) {
        throw new Error(`Deployer has no balance! ${IS_PASEO ? 'Fund wallet from Paseo faucet.' : 'Check Hardhat node.'}`);
    }

    // Create signers array (may have fewer signers on Paseo)
    signers = config.testPrivateKeys.map(pk => new ethers.Wallet(pk, provider));
    console.log(`Created ${signers.length} test signers`);

    // Load artifacts and deploy contracts using ethers.js directly
    // (bypasses Hardhat's build-info parsing which fails with PolkaVM artifacts)
    console.log('Deploying HatNFT...');
    const hatNFTArtifact = loadArtifact('contracts/hat.sol', 'HatNFT');
    const HatNFTFactory = new ethers.ContractFactory(hatNFTArtifact.abi, hatNFTArtifact.bytecode, deployer);
    contracts.hatNFT = await HatNFTFactory.deploy();
    await contracts.hatNFT.deployed();
    console.log(`HatNFT deployed to: ${contracts.hatNFT.address}`);

    console.log('Deploying RewardsManager...');
    const rewardsArtifact = loadArtifact('contracts/RewardsManager.sol', 'RewardsManager');
    const RewardsManagerFactory = new ethers.ContractFactory(rewardsArtifact.abi, rewardsArtifact.bytecode, deployer);
    contracts.rewardsManager = await RewardsManagerFactory.deploy();
    await contracts.rewardsManager.deployed();
    console.log(`RewardsManager deployed to: ${contracts.rewardsManager.address}`);

    console.log('Deploying GameManager...');
    const gameManagerArtifact = loadArtifact('contracts/gameManager.sol', 'GameManager');
    const GameManagerFactory = new ethers.ContractFactory(gameManagerArtifact.abi, gameManagerArtifact.bytecode, deployer);
    contracts.gameManager = await GameManagerFactory.deploy(contracts.hatNFT.address);
    await contracts.gameManager.deployed();
    console.log(`GameManager deployed to: ${contracts.gameManager.address}`);

    // Fund RewardsManager with ETH for testing reward distribution
    console.log('Funding RewardsManager with 1 ETH...');
    const fundTx = await deployer.sendTransaction({
        to: contracts.rewardsManager.address,
        value: ethers.utils.parseEther('1.0')
    });
    await fundTx.wait();
    console.log(`RewardsManager funded: ${contracts.rewardsManager.address}`);

    // Set environment variables with deployed addresses
    process.env.HAT_NFT_ADDRESS = contracts.hatNFT.address;
    process.env.GAME_MANAGER_ADDRESS = contracts.gameManager.address;
    process.env.REWARDS_MANAGER_ADDRESS = contracts.rewardsManager.address;

    // Set private key for server (same as deployer - account #0)
    process.env.PRIVATE_KEY = privateKey.replace(/^0x/, '');

    // Now import and start the server (after env vars are set)
    console.log('Starting test server...');
    const { startServer } = require('../src/server/index');
    server = await startServer();
    console.log('Test server started on port 3003');

    // Export for tests
    global.testContracts = contracts;
    global.testSigners = signers;
    global.testServer = server;
}, IS_PASEO ? 300000 : 120000); // 5 min for Paseo, 2 min for local

afterAll(async () => {
    console.log('Cleaning up test environment...');
    if (server) {
        await new Promise(resolve => server.close(resolve));
        console.log('Test server closed');
    }
});

module.exports = { contracts, signers };
