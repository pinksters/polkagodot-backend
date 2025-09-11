const express = require('express');
const { ethers } = require('ethers');
const fetch = require('node-fetch');

// Configuration
const HAT_NFT_ADDRESS = '0x324a3b3A6E00E07A7EC13D03d468C257350A3Df9';
const GAME_MANAGER_ADDRESS = '0xb4F7A6aF596FF963a00Bf27C9438fB88Abf5f414';
const RPC_URL = 'https://testnet-passet-hub-eth-rpc.polkadot.io';
const PORT = 3002;

// HatNFT ABI
const HAT_NFT_ABI = [
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function totalSupply() view returns (uint256)",
    "function tokenURI(uint256 tokenId) view returns (string)",
    "function getHatType(uint256 tokenId) view returns (string)"
];

// GameManagerLite ABI
const GAME_MANAGER_ABI = [
    "function playerStats(address) view returns (uint256 bestScore, uint256 bestScoreGameId, uint256 totalGames, uint256 totalWins, uint256 equippedHat, bool hasPlayed)",
    "function getTotalGames() view returns (uint256)",
    "event GameCompleted(uint256 indexed gameId, address indexed winner, uint256 playerCount, address[] players, uint256[] times, uint256[] equippedHats, uint256 timestamp)",
    "event HatEquipped(address indexed player, uint256 indexed tokenId)",
    "event NewPersonalBest(address indexed player, uint256 newBestScore, uint256 gameId)"
];

const app = express();

// Middleware
app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Initialize provider and contracts (ethers v5 syntax)
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const hatNFTContract = new ethers.Contract(HAT_NFT_ADDRESS, HAT_NFT_ABI, provider);
const gameManagerContract = new ethers.Contract(GAME_MANAGER_ADDRESS, GAME_MANAGER_ABI, provider);

async function getTokensForAddress(userAddress) {
    try {
        console.log(`🔍 Querying tokens for address: ${userAddress}`);

        // Get total supply
        const totalSupplyBN = await hatNFTContract.totalSupply();
        const totalSupply = totalSupplyBN.toNumber();
        console.log(`📊 Total tokens minted: ${totalSupply}`);

        const ownedTokens = [];

        // Check each token ID
        for (let tokenId = 1; tokenId <= totalSupply; tokenId++) {
            try {
                const owner = await hatNFTContract.ownerOf(tokenId);

                if (owner.toLowerCase() === userAddress.toLowerCase()) {
                    console.log(`✅ Token ${tokenId} owned by ${userAddress}`);

                    // Get token URI
                    const tokenURI = await hatNFTContract.tokenURI(tokenId);

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
        message: 'Hat NFT & Game Manager Server (Ethers v5)',
        contracts: {
            hatNFT: HAT_NFT_ADDRESS,
            gameManager: GAME_MANAGER_ADDRESS
        },
        rpc: RPC_URL,
        ethersVersion: '5.x',
        endpoints: {
            'GET /tokens/:address': 'Get all tokens owned by an address',
            'GET /tokens?address=0x...': 'Get all tokens owned by an address (query param)',
            'GET /info': 'Get contract information',
            'GET /player/:address/stats': 'Get player game statistics',
            'GET /player/:address/equipped': 'Get player equipped hat',
            'GET /game/:gameId': 'Get game result details',
            'GET /leaderboard': 'Get leaderboard data',
            'POST /leaderboard/custom': 'Get custom leaderboard for specific players'
        }
    });
});

// Get contract info
app.get('/info', async (req, res) => {
    try {
        const totalSupplyBN = await hatNFTContract.totalSupply();
        const totalSupply = totalSupplyBN.toNumber();

        let totalGames = 0;
        try {
            if (GAME_MANAGER_ADDRESS !== '0x0000000000000000000000000000000000000000') {
                const totalGamesBN = await gameManagerContract.getTotalGames();
                totalGames = totalGamesBN.toNumber();
            }
        } catch (error) {
            console.log('GameManager not deployed yet or error:', error.message);
        }

        res.json({
            contracts: {
                hatNFT: HAT_NFT_ADDRESS,
                gameManager: GAME_MANAGER_ADDRESS
            },
            rpc: RPC_URL,
            hatNFT: {
                totalSupply: totalSupply,
                baseURI: 'https://pinkhats.4everland.store/'
            },
            gameManager: {
                totalGames: totalGames
            },
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

// === GAME MANAGER ENDPOINTS ===

// Get player stats
app.get('/player/:address/stats', async (req, res) => {
    try {
        const { address } = req.params;

        if (!ethers.utils.isAddress(address)) {
            return res.status(400).json({
                error: 'Invalid Ethereum address',
                address: address
            });
        }

        if (GAME_MANAGER_ADDRESS === '0x0000000000000000000000000000000000000000') {
            return res.status(503).json({
                error: 'GameManager contract not deployed yet',
                message: 'Please update GAME_MANAGER_ADDRESS in configuration'
            });
        }

        const playerStats = await gameManagerContract.playerStats(address);

        const response = {
            address: address,
            stats: {
                bestScore: playerStats.bestScore.toNumber(),
                bestScoreGameId: playerStats.bestScoreGameId.toNumber(),
                totalGamesPlayed: playerStats.totalGames.toNumber(),
                totalWins: playerStats.totalWins.toNumber(),
                equippedHat: playerStats.equippedHat.toNumber(),
                hasPlayed: playerStats.hasPlayed
            },
            timestamp: new Date().toISOString()
        };

        // Add hat metadata if equipped hat is not default
        if (response.stats.equippedHat !== 0) {
            try {
                const hatType = await hatNFTContract.getHatType(response.stats.equippedHat);
                response.stats.equippedHatType = hatType;
            } catch (error) {
                console.log('Could not fetch hat type:', error.message);
            }
        }

        // Get game history from events
        try {
            const gameFilter = gameManagerContract.filters.GameCompleted(null, null, null, null, null, null, null);
            const events = await gameManagerContract.queryFilter(gameFilter);

            const gamesPlayed = [];
            for (const event of events) {
                const players = event.args.players;
                if (players.some(p => p.toLowerCase() === address.toLowerCase())) {
                    gamesPlayed.push(event.args.gameId.toNumber());
                }
            }

            response.stats.gamesPlayed = gamesPlayed;
        } catch (error) {
            console.log('Could not fetch game history:', error.message);
            response.stats.gamesPlayed = [];
        }

        res.json(response);

    } catch (error) {
        console.error('Error in /player/:address/stats:', error);
        res.status(500).json({
            error: 'Failed to get player stats',
            message: error.message
        });
    }
});

// Get player equipped hat
app.get('/player/:address/equipped', async (req, res) => {
    try {
        const { address } = req.params;

        if (!ethers.utils.isAddress(address)) {
            return res.status(400).json({
                error: 'Invalid Ethereum address',
                address: address
            });
        }

        if (GAME_MANAGER_ADDRESS === '0x0000000000000000000000000000000000000000') {
            return res.status(503).json({
                error: 'GameManager contract not deployed yet'
            });
        }

        const playerStats = await gameManagerContract.playerStats(address);
        const equippedHatId = playerStats.equippedHat;
        const hatId = equippedHatId.toNumber();

        const response = {
            address: address,
            equippedHat: {
                tokenId: hatId,
                isDefault: hatId === 0
            },
            timestamp: new Date().toISOString()
        };

        // Add hat metadata if not default
        if (hatId !== 0) {
            try {
                const hatType = await hatNFTContract.getHatType(hatId);
                response.equippedHat.hatType = hatType;
            } catch (error) {
                console.log('Could not fetch hat type:', error.message);
            }
        }

        res.json(response);

    } catch (error) {
        console.error('Error in /player/:address/equipped:', error);
        res.status(500).json({
            error: 'Failed to get equipped hat',
            message: error.message
        });
    }
});

// Get game result
app.get('/game/:gameId', async (req, res) => {
    try {
        const { gameId } = req.params;
        const gameIdNum = parseInt(gameId);

        if (isNaN(gameIdNum) || gameIdNum < 1) {
            return res.status(400).json({
                error: 'Invalid game ID',
                gameId: gameId
            });
        }

        if (GAME_MANAGER_ADDRESS === '0x0000000000000000000000000000000000000000') {
            return res.status(503).json({
                error: 'GameManager contract not deployed yet'
            });
        }

        // Get game data from events
        const gameFilter = gameManagerContract.filters.GameCompleted(gameIdNum, null, null, null, null, null, null);
        const events = await gameManagerContract.queryFilter(gameFilter);

        if (events.length === 0) {
            return res.status(404).json({
                error: 'Game not found',
                gameId: gameIdNum
            });
        }

        const gameEvent = events[0];
        const eventArgs = gameEvent.args;

        const players = [];
        for (let i = 0; i < eventArgs.playerCount.toNumber(); i++) {
            const player = {
                address: eventArgs.players[i],
                time: eventArgs.times[i].toNumber(),
                equippedHat: eventArgs.equippedHats[i].toNumber(),
                position: i + 1
            };

            // Add hat type if not default
            if (player.equippedHat !== 0) {
                try {
                    player.hatType = await hatNFTContract.getHatType(player.equippedHat);
                } catch (error) {
                    console.log('Could not fetch hat type for player:', error.message);
                }
            }

            players.push(player);
        }

        // Sort players by time (ascending - faster is better)
        players.sort((a, b) => a.time - b.time);
        players.forEach((player, index) => {
            player.position = index + 1;
        });

        res.json({
            gameId: gameIdNum,
            playerCount: eventArgs.playerCount.toNumber(),
            timestamp: new Date(eventArgs.timestamp.toNumber() * 1000).toISOString(),
            winner: eventArgs.winner,
            players: players
        });

    } catch (error) {
        console.error('Error in /game/:gameId:', error);
        res.status(500).json({
            error: 'Failed to get game result',
            message: error.message
        });
    }
});

// Get leaderboard (top players by best score)
app.get('/leaderboard', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const offset = parseInt(req.query.offset) || 0;

        if (GAME_MANAGER_ADDRESS === '0x0000000000000000000000000000000000000000') {
            return res.status(503).json({
                error: 'GameManager contract not deployed yet'
            });
        }

        // For now, return empty leaderboard with instructions
        // In a real implementation, you'd maintain a list of all player addresses
        res.json({
            message: 'Use POST /leaderboard/custom to get leaderboard for specific players',
            note: 'Contract doesn\'t maintain a global player list - provide player addresses',
            limit: limit,
            offset: offset,
            players: [],
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in /leaderboard:', error);
        res.status(500).json({
            error: 'Failed to get leaderboard',
            message: error.message
        });
    }
});

// Custom leaderboard for specific players
app.post('/leaderboard/custom', async (req, res) => {
    try {
        const { addresses } = req.body;

        if (!addresses || !Array.isArray(addresses)) {
            return res.status(400).json({
                error: 'addresses array is required',
                example: { addresses: ['0x...', '0x...'] }
            });
        }

        // Validate addresses
        for (const address of addresses) {
            if (!ethers.utils.isAddress(address)) {
                return res.status(400).json({
                    error: 'Invalid Ethereum address',
                    address: address
                });
            }
        }

        if (GAME_MANAGER_ADDRESS === '0x0000000000000000000000000000000000000000') {
            return res.status(503).json({
                error: 'GameManager contract not deployed yet'
            });
        }

        const players = [];

        // Get stats for each player
        for (const address of addresses) {
            try {
                const stats = await gameManagerContract.playerStats(address);
                players.push({
                    address: address,
                    bestScore: stats.hasPlayed ? stats.bestScore.toNumber() : null,
                    totalWins: stats.totalWins.toNumber(),
                    totalGames: stats.totalGames.toNumber(),
                    hasPlayed: stats.hasPlayed
                });
            } catch (error) {
                console.log(`Error getting stats for ${address}:`, error.message);
                players.push({
                    address: address,
                    bestScore: null,
                    totalWins: 0,
                    totalGames: 0,
                    hasPlayed: false
                });
            }
        }

        // Sort by best score (ascending - faster is better), unplayed players at the end
        players.sort((a, b) => {
            if (!a.hasPlayed && !b.hasPlayed) return 0;
            if (!a.hasPlayed) return 1;
            if (!b.hasPlayed) return -1;
            return a.bestScore - b.bestScore;
        });

        res.json({
            playerCount: addresses.length,
            players: players,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in /leaderboard/custom:', error);
        res.status(500).json({
            error: 'Failed to get custom leaderboard',
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
            'POST /tokens/batch',
            'GET /player/:address/stats',
            'GET /player/:address/equipped',
            'GET /game/:gameId',
            'GET /leaderboard',
            'POST /leaderboard/custom'
        ]
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Hat NFT & Game Manager Server running on port ${PORT}`);
    console.log(`📄 HatNFT Contract: ${HAT_NFT_ADDRESS}`);
    console.log(`🎮 GameManager Contract: ${GAME_MANAGER_ADDRESS}`);
    console.log(`🌐 RPC: ${RPC_URL}`);
    console.log(`⚙️  Using Ethers v5`);
    console.log(`\n📡 Available endpoints:`);
    console.log(`   === HAT NFT ===`);
    console.log(`   GET  http://localhost:${PORT}/`);
    console.log(`   GET  http://localhost:${PORT}/info`);
    console.log(`   GET  http://localhost:${PORT}/tokens/:address`);
    console.log(`   POST http://localhost:${PORT}/tokens/batch`);
    console.log(`   === GAME MANAGER ===`);
    console.log(`   GET  http://localhost:${PORT}/player/:address/stats`);
    console.log(`   GET  http://localhost:${PORT}/player/:address/equipped`);
    console.log(`   GET  http://localhost:${PORT}/game/:gameId`);
    console.log(`   GET  http://localhost:${PORT}/leaderboard`);
    console.log(`   POST http://localhost:${PORT}/leaderboard/custom`);
    console.log(`\n💡 Example: http://localhost:${PORT}/player/0x742d35Cc6634C0532925a3b8d0c05E6E4b8c3C0E/stats\n`);
});

module.exports = app;