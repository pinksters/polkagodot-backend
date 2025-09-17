require('dotenv').config();
const express = require('express');
const { ethers } = require('ethers');
const fetch = require('node-fetch');

// Configuration
const HAT_NFT_ADDRESS = process.env.HAT_NFT_ADDRESS || '0x19160f83751816FAF5C28F9B5086399E2653E147';
const GAME_MANAGER_ADDRESS = process.env.GAME_MANAGER_ADDRESS || '0x6B6b4C445a46c65666360abCcCAd00B12B8AD1E2';
const RPC_URL = process.env.RPC_URL || 'https://testnet-passet-hub-eth-rpc.polkadot.io';
const PORT = process.env.PORT || 3002;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// HatNFT ABI
const HAT_NFT_ABI = [
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function totalSupply() view returns (uint256)",
    "function tokenURI(uint256 tokenId) view returns (string)",
    "function getHatType(uint256 tokenId) view returns (string)"
];

// GameManager ABI
const GAME_MANAGER_ABI = [
    "function playerStats(address) view returns (uint256 bestScore, uint256 totalWins, uint256 equippedHat, bool hasPlayed)",
    "function getTotalGames() view returns (uint256)",
    "function isDescendingOrder() view returns (bool)",
    "function getEquippedHat(address player) view returns (uint256)",
    "event GameSubmitted(uint256 indexed gameId, address indexed winner, uint256 playerCount, address[] players, uint256[] scores)",
    "event ScoreOrderingChanged(bool isDescendingOrder)"
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

// Initialize wallet if private key is provided
let wallet;
let gameManagerWithSigner;
if (PRIVATE_KEY) {
    wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    gameManagerWithSigner = new ethers.Contract(GAME_MANAGER_ADDRESS, GAME_MANAGER_ABI, wallet);
    console.log(`🔑 Wallet connected: ${wallet.address}`);
} else {
    console.log('⚠️  No private key provided - only read operations available');
}

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
            'GET /scoring': 'Get current scoring mode',
            'GET /leaderboard': 'Get leaderboard data',
            'POST /leaderboard/custom': 'Get custom leaderboard for specific players',
            'POST /admin/submit-game': 'Submit game results (requires private key)',
            'POST /admin/toggle-scoring': 'Toggle score ordering mode (requires private key)'
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

        let isDescendingOrder = true;
        try {
            if (GAME_MANAGER_ADDRESS !== '0x0000000000000000000000000000000000000000') {
                isDescendingOrder = await gameManagerContract.isDescendingOrder();
            }
        } catch (error) {
            console.log('Could not get scoring mode:', error.message);
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
                totalGames: totalGames,
                isDescendingOrder: isDescendingOrder,
                scoringMode: isDescendingOrder ? 'Higher scores better' : 'Lower scores better'
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

// === ADMIN ENDPOINTS (Require Private Key) ===

// Submit game results
app.post('/admin/submit-game', async (req, res) => {
    try {
        if (!gameManagerWithSigner) {
            return res.status(403).json({
                error: 'Private key required',
                message: 'This endpoint requires PRIVATE_KEY to be set in environment variables'
            });
        }

        const { players, scores } = req.body;

        if (!players || !scores || !Array.isArray(players) || !Array.isArray(scores)) {
            return res.status(400).json({
                error: 'Invalid request body',
                message: 'Required: { "players": ["0x...", "0x..."], "scores": [100, 75, 120] }'
            });
        }

        if (players.length !== scores.length) {
            return res.status(400).json({
                error: 'Arrays length mismatch',
                message: 'players and scores arrays must have the same length'
            });
        }

        if (players.length === 0 || players.length > 7) {
            return res.status(400).json({
                error: 'Invalid player count',
                message: 'Must have between 1 and 7 players'
            });
        }

        // Validate addresses
        for (const address of players) {
            if (!ethers.utils.isAddress(address)) {
                return res.status(400).json({
                    error: 'Invalid Ethereum address',
                    address: address
                });
            }
        }

        // Validate scores are numbers
        for (const score of scores) {
            if (typeof score !== 'number' || score < 0) {
                return res.status(400).json({
                    error: 'Invalid score',
                    message: 'All scores must be positive numbers'
                });
            }
        }

        console.log(`🎮 Submitting game with ${players.length} players...`);

        // Submit transaction
        const tx = await gameManagerWithSigner.submitGameResult(players, scores);
        console.log(`📡 Transaction sent: ${tx.hash}`);

        // Wait for confirmation
        const receipt = await tx.wait();
        console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);

        // Get the current game ID (it was incremented after submission)
        const currentGameId = await gameManagerContract.getTotalGames();
        const gameId = currentGameId.toNumber();

        res.json({
            success: true,
            gameId: gameId,
            transactionHash: tx.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            players: players,
            scores: scores,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in /admin/submit-game:', error);
        res.status(500).json({
            error: 'Failed to submit game results',
            message: error.message,
            ...(error.code && { code: error.code }),
            ...(error.reason && { reason: error.reason })
        });
    }
});

// Toggle score ordering
app.post('/admin/toggle-scoring', async (req, res) => {
    try {
        if (!gameManagerWithSigner) {
            return res.status(403).json({
                error: 'Private key required',
                message: 'This endpoint requires PRIVATE_KEY to be set in environment variables'
            });
        }

        // Get current mode before toggling
        const currentMode = await gameManagerContract.isDescendingOrder();

        console.log(`🔄 Toggling score ordering from ${currentMode ? 'descending' : 'ascending'}...`);

        // Submit transaction
        const tx = await gameManagerWithSigner.toggleScoreOrdering();
        console.log(`📡 Transaction sent: ${tx.hash}`);

        // Wait for confirmation
        const receipt = await tx.wait();
        console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);

        // Get new mode after toggling
        const newMode = await gameManagerContract.isDescendingOrder();

        res.json({
            success: true,
            previousMode: {
                isDescendingOrder: currentMode,
                description: currentMode ? 'Higher scores better' : 'Lower scores better'
            },
            newMode: {
                isDescendingOrder: newMode,
                description: newMode ? 'Higher scores better' : 'Lower scores better'
            },
            transactionHash: tx.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in /admin/toggle-scoring:', error);
        res.status(500).json({
            error: 'Failed to toggle score ordering',
            message: error.message,
            ...(error.code && { code: error.code }),
            ...(error.reason && { reason: error.reason })
        });
    }
});

// === PUBLIC ENDPOINTS ===

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

        // Get game history from events since contract no longer stores it
        try {
            const gameFilter = gameManagerContract.filters.GameSubmitted(null, null, null, null, null);
            const events = await gameManagerContract.queryFilter(gameFilter);

            const gamesPlayed = [];
            for (const event of events) {
                const players = event.args.players;
                if (players.some(p => p.toLowerCase() === address.toLowerCase())) {
                    gamesPlayed.push(event.args.gameId.toNumber());
                }
            }

            response.stats.gamesPlayed = gamesPlayed;
            response.stats.totalGamesPlayed = gamesPlayed.length;
        } catch (error) {
            console.log('Could not fetch game history:', error.message);
            response.stats.gamesPlayed = [];
            response.stats.totalGamesPlayed = 0;
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

// Get current scoring mode
app.get('/scoring', async (req, res) => {
    try {
        if (GAME_MANAGER_ADDRESS === '0x0000000000000000000000000000000000000000') {
            return res.status(503).json({
                error: 'GameManager contract not deployed yet'
            });
        }

        const isDescendingOrder = await gameManagerContract.isDescendingOrder();

        res.json({
            isDescendingOrder: isDescendingOrder,
            scoringMode: isDescendingOrder ? 'Higher scores better' : 'Lower scores better',
            description: isDescendingOrder ?
                'Descending mode: 100 beats 50 (higher is better)' :
                'Ascending mode: 50 beats 100 (lower is better)',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in /scoring:', error);
        res.status(500).json({
            error: 'Failed to get scoring mode',
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

        const equippedHatId = await gameManagerContract.getEquippedHat(address);
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

        // Get game data from events since contract no longer stores game results
        const gameFilter = gameManagerContract.filters.GameSubmitted(gameIdNum, null, null, null, null);
        const events = await gameManagerContract.queryFilter(gameFilter);

        if (events.length === 0) {
            return res.status(404).json({
                error: 'Game not found',
                gameId: gameIdNum
            });
        }

        const gameEvent = events[0];
        const eventArgs = gameEvent.args;

        // Get current scoring mode
        const isDescendingOrder = await gameManagerContract.isDescendingOrder();

        const players = [];
        for (let i = 0; i < eventArgs.playerCount.toNumber(); i++) {
            const player = {
                address: eventArgs.players[i],
                score: eventArgs.scores[i].toNumber(),
                position: i + 1
            };

            // Get equipped hat at time of game (from contract state)
            try {
                const equippedHat = await gameManagerContract.getEquippedHat(eventArgs.players[i]);
                player.equippedHat = equippedHat.toNumber();

                // Add hat type if not default
                if (player.equippedHat !== 0) {
                    try {
                        player.hatType = await hatNFTContract.getHatType(player.equippedHat);
                    } catch (error) {
                        console.log('Could not fetch hat type for player:', error.message);
                    }
                }
            } catch (error) {
                console.log('Could not fetch equipped hat for player:', error.message);
                player.equippedHat = 0;
            }

            players.push(player);
        }

        // Sort players by score according to current scoring mode
        players.sort((a, b) => {
            return isDescendingOrder ? b.score - a.score : a.score - b.score;
        });
        players.forEach((player, index) => {
            player.position = index + 1;
        });

        res.json({
            gameId: gameIdNum,
            playerCount: eventArgs.playerCount.toNumber(),
            timestamp: new Date(gameEvent.blockNumber ? 'Unknown' : new Date().toISOString()),
            winner: eventArgs.winner,
            isDescendingOrder: isDescendingOrder,
            scoringMode: isDescendingOrder ? 'Higher scores better' : 'Lower scores better',
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

        // Get current scoring mode
        const isDescendingOrder = await gameManagerContract.isDescendingOrder();

        const players = [];

        // Get stats for each player
        for (const address of addresses) {
            try {
                const stats = await gameManagerContract.playerStats(address);

                // Get total games from events
                let totalGames = 0;
                try {
                    const gameFilter = gameManagerContract.filters.GameSubmitted(null, null, null, null, null);
                    const events = await gameManagerContract.queryFilter(gameFilter);

                    for (const event of events) {
                        const players = event.args.players;
                        if (players.some(p => p.toLowerCase() === address.toLowerCase())) {
                            totalGames++;
                        }
                    }
                } catch (error) {
                    console.log('Could not fetch game count for player:', error.message);
                }

                players.push({
                    address: address,
                    bestScore: stats.hasPlayed ? stats.bestScore.toNumber() : null,
                    totalWins: stats.totalWins.toNumber(),
                    totalGames: totalGames,
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

        // Sort by best score according to current scoring mode, unplayed players at the end
        players.sort((a, b) => {
            if (!a.hasPlayed && !b.hasPlayed) return 0;
            if (!a.hasPlayed) return 1;
            if (!b.hasPlayed) return -1;
            return isDescendingOrder ? b.bestScore - a.bestScore : a.bestScore - b.bestScore;
        });

        res.json({
            playerCount: addresses.length,
            isDescendingOrder: isDescendingOrder,
            scoringMode: isDescendingOrder ? 'Higher scores better' : 'Lower scores better',
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
            'GET /scoring',
            'GET /leaderboard',
            'POST /leaderboard/custom',
            'POST /admin/submit-game',
            'POST /admin/toggle-scoring'
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
    console.log(`   GET  http://localhost:${PORT}/scoring`);
    console.log(`   GET  http://localhost:${PORT}/leaderboard`);
    console.log(`   POST http://localhost:${PORT}/leaderboard/custom`);
    console.log(`   === ADMIN ENDPOINTS ===`);
    console.log(`   POST http://localhost:${PORT}/admin/submit-game`);
    console.log(`   POST http://localhost:${PORT}/admin/toggle-scoring`);
    console.log(`\n💡 Example: http://localhost:${PORT}/player/0x742d35Cc6634C0532925a3b8d0c05E6E4b8c3C0E/stats\n`);
});

module.exports = app;