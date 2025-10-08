require('dotenv').config();
const express = require('express');
const { ethers } = require('ethers');
const fetch = require('node-fetch');
const GameDatabase = require('./database');

// Configuration
const HAT_NFT_ADDRESS = process.env.HAT_NFT_ADDRESS || '0xc180757733B4c7303336799BAfc7dC410e6715B4';
const GAME_MANAGER_ADDRESS = process.env.GAME_MANAGER_ADDRESS || '0x2e079c40099a0bAd5EB89478e748D07567292F6e';
const RPC_URL = process.env.RPC_URL || 'https://testnet-passet-hub-eth-rpc.polkadot.io';
const PORT = process.env.PORT || 3002;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// HatNFT ABI
const HAT_NFT_ABI = [
    "function ownerOf(uint256 tokenId) view returns (address)",
    "function totalSupply() view returns (uint256)",
    "function tokenURI(uint256 tokenId) view returns (string)",
    "function transfer(address to, uint256 tokenId)",
    "function setGameManager(address _gameManager)"
];

// GameManager ABI
const GAME_MANAGER_ABI = [
    "function playerStats(address) view returns (uint256 bestScore, uint256 totalWins, uint256 equippedHat, bool hasPlayed)",
    "function getTotalGames() view returns (uint256)",
    "function isDescendingOrder() view returns (bool)",
    "function equipHat(uint256 tokenId)",
    "function unequipHat()",
    "function getEquippedHat(address player) view returns (uint256)",
    "function verifyHatOwnership(address player) view returns (bool)",
    "function unequipHatForPlayer(address player, uint256 tokenId)",
    "function submitGameResult(address[] players, uint256[] scores)",
    "function toggleScoreOrdering()",
    "event GameSubmitted(uint256 indexed gameId, address indexed winner, uint256 playerCount, address[] players, uint256[] scores)",
    "event ScoreOrderingChanged(bool isDescendingOrder)"
];

// Initialize database
const db = new GameDatabase();

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

// === UTILITY FUNCTIONS ===

async function getHatTypeFromTokenId(tokenId) {
    try {
        if (tokenId === 0) {
            return "No Hat";
        }

        // Get token URI
        const tokenURI = await hatNFTContract.tokenURI(tokenId);

        // Fetch JSON metadata
        const response = await fetch(tokenURI);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const metadata = await response.json();
        return metadata.name || `Hat #${tokenId}`;

    } catch (error) {
        console.log(`Could not fetch hat type for token ${tokenId}:`, error.message);
        return `Hat #${tokenId}`;
    }
}

// === DATABASE SYNC FUNCTIONS ===

async function syncGameFromEvent(event) {
    try {
        const args = event.args;
        const gameId = args.gameId.toNumber();

        // Check if game already exists in DB
        if (db.gameExists(gameId)) {
            console.log(`⏭️  Game ${gameId} already in database, skipping...`);
            return;
        }

        console.log(`💾 Syncing game ${gameId} to database...`);

        // Get current scoring mode (assume it matches the event time)
        const isDescendingOrder = await gameManagerContract.isDescendingOrder();

        // Insert game record
        db.insertGame({
            gameId: gameId,
            blockNumber: event.blockNumber,
            transactionHash: event.transactionHash,
            winner: args.winner,
            playerCount: args.playerCount.toNumber(),
            isDescendingOrder: isDescendingOrder
        });

        // Sort players by score according to current mode for position calculation
        const players = [];
        for (let i = 0; i < args.playerCount.toNumber(); i++) {
            players.push({
                address: args.players[i],
                score: args.scores[i].toNumber()
            });
        }

        players.sort((a, b) => {
            return isDescendingOrder ? b.score - a.score : a.score - b.score;
        });

        // Insert participants with their hat info
        for (let i = 0; i < players.length; i++) {
            const player = players[i];

            // Get equipped hat info (from current state - limitation of blockchain)
            let equippedHat = 0;
            let hatType = null;
            try {
                const hatId = await gameManagerContract.getEquippedHat(player.address);
                equippedHat = hatId.toNumber();

                if (equippedHat !== 0) {
                    // Get actual hat type from JSON metadata
                    hatType = await getHatTypeFromTokenId(equippedHat);
                }
            } catch (error) {
                console.log(`Could not fetch hat for ${player.address}:`, error.message);
            }

            db.insertGameParticipant({
                gameId: gameId,
                playerAddress: player.address,
                score: player.score,
                position: i + 1,
                equippedHatId: equippedHat,
                hatType: hatType
            });
        }

        // Update player stats for all participants
        await updatePlayerStats(players.map(p => p.address));

        console.log(`✅ Game ${gameId} synced to database`);

    } catch (error) {
        console.error(`❌ Error syncing game ${event.args?.gameId?.toNumber() || 'unknown'}:`, error);
    }
}

async function updatePlayerStats(playerAddresses) {
    for (const address of playerAddresses) {
        try {
            // Get stats from blockchain
            const stats = await gameManagerContract.playerStats(address);
            const equippedHat = await gameManagerContract.getEquippedHat(address);

            // Count games from database
            const gameHistory = db.getPlayerGameHistory(address);
            const totalGames = gameHistory.length;

            db.upsertPlayerStats({
                playerAddress: address,
                bestScore: stats.hasPlayed ? stats.bestScore.toNumber() : null,
                totalWins: stats.totalWins.toNumber(),
                totalGames: totalGames,
                currentEquippedHat: equippedHat.toNumber(),
                hasPlayed: stats.hasPlayed
            });

        } catch (error) {
            console.error(`Error updating stats for ${address}:`, error.message);
        }
    }
}

async function syncHistoricalGames() {
    try {
        console.log('🔄 Syncing historical games...');

        const syncState = db.getSyncState();
        const startBlock = syncState.last_synced_block || 0;

        // Get all GameSubmitted events from last synced block
        const filter = gameManagerContract.filters.GameSubmitted();
        const events = await gameManagerContract.queryFilter(filter, startBlock);

        console.log(`📚 Found ${events.length} historical games to sync`);

        for (const event of events) {
            await syncGameFromEvent(event);
        }

        // Update sync state
        if (events.length > 0) {
            const latestEvent = events[events.length - 1];
            const latestGameId = latestEvent.args.gameId.toNumber();
            db.updateSyncState(latestEvent.blockNumber, latestGameId);
        }

        console.log('✅ Historical sync complete');

    } catch (error) {
        console.error('❌ Error syncing historical games:', error);
    }
}

// Start event listeners for real-time sync
function startEventListeners() {
    console.log('👂 Starting blockchain event listeners...');

    // Listen for new games
    gameManagerContract.on('GameSubmitted', (gameId, winner, playerCount, players, scores, event) => {
        console.log(`🎮 New game event detected: Game ${gameId.toNumber()}`);
        syncGameFromEvent(event);
    });

    // Listen for score ordering changes
    gameManagerContract.on('ScoreOrderingChanged', (isDescendingOrder, event) => {
        console.log(`🔄 Score ordering changed: ${isDescendingOrder ? 'Descending' : 'Ascending'}`);
    });

    console.log('✅ Event listeners active');
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
            'GET /db/info': 'Get database statistics and sync info',
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
                baseURI: 'https://hat.dotispink.com/'
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

// Get database info
app.get('/db/info', async (req, res) => {
    try {
        const syncState = db.getSyncState();

        // Get database counts
        const gameCount = db.db.prepare('SELECT COUNT(*) as count FROM games').get().count;
        const playerCount = db.db.prepare('SELECT COUNT(*) as count FROM player_stats WHERE has_played = TRUE').get().count;
        const participantCount = db.db.prepare('SELECT COUNT(*) as count FROM game_participants').get().count;

        // Get recent games
        const recentGames = db.getAllGames(5, 0);

        res.json({
            database: {
                file: 'pinkhat.db',
                tables: {
                    games: gameCount,
                    players: playerCount,
                    participants: participantCount
                }
            },
            sync: {
                lastSyncedBlock: syncState?.last_synced_block || 0,
                lastSyncedGameId: syncState?.last_synced_game_id || 0,
                lastSyncTime: syncState?.last_sync_time || null,
                status: gameCount > 0 ? 'synced' : 'empty'
            },
            recentGames: recentGames.map(g => ({
                gameId: g.game_id,
                playerCount: g.player_count,
                winner: g.winner_address,
                blockNumber: g.block_number,
                timestamp: g.created_at
            })),
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error getting database info:', error);
        res.status(500).json({
            error: 'Failed to get database information',
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

        // Try to get stats from database first (much faster)
        try {
            const dbResult = db.getPlayerStats(address);

            if (dbResult.stats) {
                const response = {
                    address: address,
                    stats: {
                        bestScore: dbResult.stats.best_score,
                        totalWins: dbResult.stats.total_wins,
                        totalGamesPlayed: dbResult.stats.total_games,
                        equippedHat: dbResult.stats.current_equipped_hat,
                        hasPlayed: dbResult.stats.has_played,
                        gamesPlayed: dbResult.games.map(g => g.game_id)
                    },
                    gameHistory: dbResult.games.map(game => ({
                        gameId: game.game_id,
                        score: game.score,
                        position: game.position,
                        equippedHat: game.equipped_hat_id,
                        hatType: game.hat_type,
                        won: game.won,
                        timestamp: game.created_at
                    })),
                    source: 'database',
                    timestamp: new Date().toISOString()
                };

                // Add current equipped hat type from JSON metadata
                if (response.stats.equippedHat !== 0) {
                    try {
                        const hatType = await getHatTypeFromTokenId(response.stats.equippedHat);
                        response.stats.equippedHatType = hatType;
                    } catch (error) {
                        console.log('Could not fetch current hat type:', error.message);
                    }
                }

                return res.json(response);
            }
        } catch (error) {
            console.log('Database query failed, falling back to blockchain:', error.message);
        }

        // Fallback to blockchain query
        console.log(`🔗 Querying blockchain for ${address} stats (database miss)`);

        const playerStats = await gameManagerContract.playerStats(address);

        const response = {
            address: address,
            stats: {
                bestScore: playerStats.bestScore.toNumber(),
                totalWins: playerStats.totalWins.toNumber(),
                equippedHat: playerStats.equippedHat.toNumber(),
                hasPlayed: playerStats.hasPlayed
            },
            source: 'blockchain',
            timestamp: new Date().toISOString()
        };

        // Add equipped hat type from JSON metadata
        if (response.stats.equippedHat !== 0) {
            try {
                const hatType = await getHatTypeFromTokenId(response.stats.equippedHat);
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
                const hatType = await getHatTypeFromTokenId(hatId);
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

        // Try to get game from database first
        try {
            const gameData = db.getGame(gameIdNum);

            if (gameData) {
                const response = {
                    gameId: gameIdNum,
                    playerCount: gameData.player_count,
                    blockNumber: gameData.block_number,
                    transactionHash: gameData.transaction_hash,
                    timestamp: gameData.created_at,
                    winner: gameData.winner_address,
                    isDescendingOrder: gameData.is_descending_order,
                    scoringMode: gameData.is_descending_order ? 'Higher scores better' : 'Lower scores better',
                    players: gameData.participants.map(p => ({
                        address: p.player_address,
                        score: p.score,
                        position: p.position,
                        equippedHat: p.equipped_hat_id,
                        hatType: p.hat_type
                    })),
                    source: 'database'
                };

                return res.json(response);
            }
        } catch (error) {
            console.log('Database query failed, falling back to blockchain:', error.message);
        }

        // Fallback to blockchain query
        console.log(`🔗 Querying blockchain for game ${gameIdNum} (database miss)`);

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
                        player.hatType = await getHatTypeFromTokenId(player.equippedHat);
                    } catch (error) {
                        player.hatType = `Hat #${player.equippedHat}`;
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
            blockNumber: gameEvent.blockNumber,
            transactionHash: gameEvent.transactionHash,
            timestamp: new Date().toISOString(),
            winner: eventArgs.winner,
            isDescendingOrder: isDescendingOrder,
            scoringMode: isDescendingOrder ? 'Higher scores better' : 'Lower scores better',
            players: players,
            source: 'blockchain'
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

        if (GAME_MANAGER_ADDRESS === '0x0000000000000000000000000000000000000000') {
            return res.status(503).json({
                error: 'GameManager contract not deployed yet'
            });
        }

        // Try to get leaderboard from database first
        try {
            const players = db.getLeaderboard(limit);

            if (players.length > 0) {
                const leaderboard = players.map((player, index) => ({
                    rank: index + 1,
                    address: player.player_address,
                    bestScore: player.best_score,
                    totalWins: player.total_wins,
                    totalGames: player.total_games,
                    currentEquippedHat: player.current_equipped_hat,
                    hasPlayed: player.has_played,
                    lastUpdated: player.last_updated
                }));

                return res.json({
                    playerCount: players.length,
                    players: leaderboard,
                    source: 'database',
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            console.log('Database leaderboard failed, using fallback:', error.message);
        }

        // Fallback message if no database data
        res.json({
            message: 'No player data available yet. Use POST /leaderboard/custom for specific players or wait for database sync',
            note: 'Database will populate as games are played',
            playerCount: 0,
            players: [],
            source: 'fallback',
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
app.listen(PORT, async () => {
    console.log(`🚀 Hat NFT & Game Manager Server running on port ${PORT}`);
    console.log(`📄 HatNFT Contract: ${HAT_NFT_ADDRESS}`);
    console.log(`🎮 GameManager Contract: ${GAME_MANAGER_ADDRESS}`);
    console.log(`🌐 RPC: ${RPC_URL}`);
    console.log(`⚙️  Using Ethers v5`);
    console.log(`💾 Database: SQLite (pinkhat.db)`);

    // Initialize blockchain sync
    try {
        await syncHistoricalGames();
        startEventListeners();
    } catch (error) {
        console.error('❌ Failed to initialize blockchain sync:', error.message);
        console.log('⚠️  Server will continue but database may be out of sync');
    }

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

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    db.close();
    console.log('💾 Database connection closed');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down server...');
    db.close();
    console.log('💾 Database connection closed');
    process.exit(0);
});

module.exports = app;