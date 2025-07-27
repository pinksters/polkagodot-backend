const express = require('express');
const { ethers } = require('ethers');
const fetch = require('node-fetch'); // Add this for ethers v5 compatibility

// Configuration
const CONTRACT_ADDRESS = '0x324a3b3A6E00E07A7EC13D03d468C257350A3Df9';
const RPC_URL = 'https://testnet-passet-hub-eth-rpc.polkadot.io';
const PORT = 3002;

// Minimal ABI for our contract
const CONTRACT_ABI = [
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function totalSupply() view returns (uint256)",
    "function tokenURI(uint256 tokenId) view returns (string)"
];

const app = express();

// Middleware
app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Initialize provider and contract (ethers v5 syntax)
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

async function getTokensForAddress(userAddress) {
    try {
        console.log(`🔍 Querying tokens for address: ${userAddress}`);

        // Get total supply
        const totalSupplyBN = await contract.totalSupply();
        const totalSupply = totalSupplyBN.toNumber();
        console.log(`📊 Total tokens minted: ${totalSupply}`);

        const ownedTokens = [];

        // Check each token ID
        for (let tokenId = 1; tokenId <= totalSupply; tokenId++) {
            try {
                const owner = await contract.ownerOf(tokenId);

                if (owner.toLowerCase() === userAddress.toLowerCase()) {
                    console.log(`✅ Token ${tokenId} owned by ${userAddress}`);

                    // Get token URI
                    const tokenURI = await contract.tokenURI(tokenId);

                    // Fetch JSON metadata
                    try {
                        const response = await fetch(tokenURI);
                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                        }
                        const metadata = await response.json();

                        ownedTokens.push({
                            tokenId: tokenId,
                            owner: owner,
                            tokenURI: tokenURI,
                            metadata: metadata
                        });

                        console.log(`📄 Fetched metadata for token ${tokenId}: ${metadata.name}`);
                    } catch (metadataError) {
                        console.log(`⚠️ Could not fetch metadata for token ${tokenId}: ${metadataError.message}`);

                        ownedTokens.push({
                            tokenId: tokenId,
                            owner: owner,
                            tokenURI: tokenURI,
                            metadata: null,
                            metadataError: metadataError.message
                        });
                    }
                }
            } catch (error) {
                console.log(`⚠️ Token ${tokenId} does not exist or error: ${error.message}`);
            }
        }

        console.log(`🎉 Found ${ownedTokens.length} tokens owned by ${userAddress}`);
        return ownedTokens;

    } catch (error) {
        console.error('❌ Error querying tokens:', error);
        throw error;
    }
}

// Routes

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'OK',
        message: 'Hat NFT Query Server (Ethers v5)',
        contract: CONTRACT_ADDRESS,
        rpc: RPC_URL,
        ethersVersion: '5.x',
        endpoints: {
            'GET /tokens/:address': 'Get all tokens owned by an address',
            'GET /tokens?address=0x...': 'Get all tokens owned by an address (query param)',
            'GET /info': 'Get contract information'
        }
    });
});

// Get contract info
app.get('/info', async (req, res) => {
    try {
        const totalSupplyBN = await contract.totalSupply();
        const totalSupply = totalSupplyBN.toNumber();

        res.json({
            contract: CONTRACT_ADDRESS,
            rpc: RPC_URL,
            totalSupply: totalSupply,
            baseURI: 'https://pinkhats.4everland.store/',
            ethersVersion: '5.x'
        });
    } catch (error) {
        console.error('Error getting contract info:', error);
        res.status(500).json({
            error: 'Failed to get contract information',
            message: error.message
        });
    }
});

// Get tokens by address (path parameter)
app.get('/tokens/:address', async (req, res) => {
    try {
        const { address } = req.params;

        // Validate address (ethers v5 syntax)
        if (!ethers.utils.isAddress(address)) {
            return res.status(400).json({
                error: 'Invalid Ethereum address',
                address: address
            });
        }

        const tokens = await getTokensForAddress(address);

        res.json({
            address: address,
            tokenCount: tokens.length,
            tokens: tokens,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in /tokens/:address:', error);
        res.status(500).json({
            error: 'Failed to query tokens',
            message: error.message
        });
    }
});

// Get tokens by address (query parameter)
app.get('/tokens', async (req, res) => {
    try {
        const { address } = req.query;

        if (!address) {
            return res.status(400).json({
                error: 'Address parameter is required',
                example: '/tokens?address=0x742d35Cc6634C0532925a3b8d0c05E6E4b8c3C0E'
            });
        }

        // Validate address (ethers v5 syntax)
        if (!ethers.utils.isAddress(address)) {
            return res.status(400).json({
                error: 'Invalid Ethereum address',
                address: address
            });
        }

        const tokens = await getTokensForAddress(address);

        res.json({
            address: address,
            tokenCount: tokens.length,
            tokens: tokens,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in /tokens:', error);
        res.status(500).json({
            error: 'Failed to query tokens',
            message: error.message
        });
    }
});

// Get multiple addresses (POST endpoint for batch queries)
app.post('/tokens/batch', async (req, res) => {
    try {
        const { addresses } = req.body;

        if (!addresses || !Array.isArray(addresses)) {
            return res.status(400).json({
                error: 'addresses array is required',
                example: { addresses: ['0x...', '0x...'] }
            });
        }

        // Validate all addresses (ethers v5 syntax)
        for (const address of addresses) {
            if (!ethers.utils.isAddress(address)) {
                return res.status(400).json({
                    error: 'Invalid Ethereum address',
                    address: address
                });
            }
        }

        const results = {};

        for (const address of addresses) {
            try {
                results[address] = await getTokensForAddress(address);
            } catch (error) {
                console.error(`Error querying ${address}:`, error.message);
                results[address] = { error: error.message };
            }
        }

        res.json({
            results: results,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in /tokens/batch:', error);
        res.status(500).json({
            error: 'Failed to query tokens',
            message: error.message
        });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: error.message
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        availableEndpoints: [
            'GET /',
            'GET /info',
            'GET /tokens/:address',
            'GET /tokens?address=0x...',
            'POST /tokens/batch'
        ]
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Hat NFT Query Server running on port ${PORT}`);
    console.log(`📄 Contract: ${CONTRACT_ADDRESS}`);
    console.log(`🌐 RPC: ${RPC_URL}`);
    console.log(`⚙️  Using Ethers v5`);
    console.log(`\n📡 Available endpoints:`);
    console.log(`   GET  http://localhost:${PORT}/`);
    console.log(`   GET  http://localhost:${PORT}/info`);
    console.log(`   GET  http://localhost:${PORT}/tokens/:address`);
    console.log(`   GET  http://localhost:${PORT}/tokens?address=0x...`);
    console.log(`   POST http://localhost:${PORT}/tokens/batch`);
    console.log(`\n💡 Example: http://localhost:${PORT}/tokens/0x742d35Cc6634C0532925a3b8d0c05E6E4b8c3C0E\n`);
});

module.exports = app;