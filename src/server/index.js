require('dotenv').config({ path: './config/.env' });
const express = require('express');
const { ethers } = require('ethers');
const fetch = require('node-fetch');
const GameDatabase = require('./database');

// Configuration
const HAT_NFT_ADDRESS = process.env.HAT_NFT_ADDRESS || '';
const GAME_MANAGER_ADDRESS = process.env.GAME_MANAGER_ADDRESS || '';
const REWARDS_MANAGER_ADDRESS = process.env.REWARDS_MANAGER_ADDRESS || '';
const RPC_URL = process.env.RPC_URL || 'https://testnet-passet-hub-eth-rpc.polkadot.io';
const PORT = process.env.PORT || 3002;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// Security Configuration
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const RATE_LIMIT_REQUESTS = parseInt(process.env.RATE_LIMIT_REQUESTS) || 100;
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
const ALLOWED_IPS = process.env.ALLOWED_IPS ? process.env.ALLOWED_IPS.split(',') : [];

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

// RewardsManager ABI - Minimal version
const REWARDS_MANAGER_ABI = [
    "function totalRewardAmount() view returns (uint256)",
    "function numberOfWinners() view returns (uint8)",
    "function isActive() view returns (bool)",
    "function percent1() view returns (uint256)",
    "function percent2() view returns (uint256)",
    "function percent3() view returns (uint256)",
    "function gameResultsStored(uint256) view returns (bool)",
    "function configureGlobalRewards(uint256 totalRewardAmount, uint8 numberOfWinners, uint256[] rewardPercentages)",
    "function submitGameResults(uint256 gameId, address[] winners)",
    "function batchDistributeRewards(uint256 gameId)",
    "function distributeLeaderboardRewards(address[] winners, uint256[] amounts)"
];

// Initialize database
const db = new GameDatabase();

const app = express();

// === SECURITY MIDDLEWARE ===

// Rate limiting map (in-memory, use Redis for production)
const rateLimitMap = new Map();

// Rate limiting middleware
const rateLimit = (req, res, next) => {
    const clientIp = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;

    if (!rateLimitMap.has(clientIp)) {
        rateLimitMap.set(clientIp, []);
    }

    const requests = rateLimitMap.get(clientIp);
    // Remove old requests outside the window
    const validRequests = requests.filter(timestamp => timestamp > windowStart);

    if (validRequests.length >= RATE_LIMIT_REQUESTS) {
        return res.status(429).json({
            error: 'Rate limit exceeded',
            message: `Too many requests. Limit: ${RATE_LIMIT_REQUESTS} requests per ${RATE_LIMIT_WINDOW_MS/1000} seconds`
        });
    }

    validRequests.push(now);
    rateLimitMap.set(clientIp, validRequests);
    next();
};

// IP whitelist middleware
const ipWhitelist = (req, res, next) => {
    if (ALLOWED_IPS.length === 0) return next(); // No IP restrictions

    const clientIp = req.ip || req.connection.remoteAddress;
    if (!ALLOWED_IPS.includes(clientIp) && !ALLOWED_IPS.includes('0.0.0.0')) {
        console.log(`⚠️  Blocked request from unauthorized IP: ${clientIp}`);
        return res.status(403).json({
            error: 'Access denied',
            message: 'Your IP address is not authorized'
        });
    }
    next();
};

// Admin API key authentication middleware
const adminAuth = (req, res, next) => {
    if (!ADMIN_API_KEY) {
        return res.status(503).json({
            error: 'Admin API key not configured',
            message: 'ADMIN_API_KEY must be set in environment variables'
        });
    }

    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

    if (!apiKey || apiKey !== ADMIN_API_KEY) {
        console.log(`⚠️  Unauthorized admin access attempt from ${req.ip}`);
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Valid API key required for admin operations'
        });
    }
    next();
};

// Request sanitization middleware
const sanitizeInput = (req, res, next) => {
    // Remove null bytes and normalize strings
    const sanitize = (obj) => {
        if (typeof obj === 'string') {
            return obj.replace(/\0/g, '').trim();
        }
        if (Array.isArray(obj)) {
            return obj.map(sanitize);
        }
        if (obj && typeof obj === 'object') {
            const sanitized = {};
            for (const [key, value] of Object.entries(obj)) {
                sanitized[key] = sanitize(value);
            }
            return sanitized;
        }
        return obj;
    };

    if (req.body) req.body = sanitize(req.body);
    if (req.query) req.query = sanitize(req.query);
    if (req.params) req.params = sanitize(req.params);
    next();
};

// Basic Middleware
app.use(express.json({ limit: '10mb' })); // Limit payload size
app.use(rateLimit);
app.use(sanitizeInput);
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-API-Key, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    // Security headers
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'DENY');
    res.header('X-XSS-Protection', '1; mode=block');

    next();
});

// Initialize provider and contracts (ethers v5 syntax)
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const hatNFTContract = new ethers.Contract(HAT_NFT_ADDRESS, HAT_NFT_ABI, provider);
const gameManagerContract = new ethers.Contract(GAME_MANAGER_ADDRESS, GAME_MANAGER_ABI, provider);

// Initialize RewardsManager contract if address is provided
let rewardsManagerContract;
if (REWARDS_MANAGER_ADDRESS !== '0x0000000000000000000000000000000000000000') {
    rewardsManagerContract = new ethers.Contract(REWARDS_MANAGER_ADDRESS, REWARDS_MANAGER_ABI, provider);
}

// Initialize wallet if private key is provided
let wallet;
let gameManagerWithSigner;
let rewardsManagerWithSigner;
if (PRIVATE_KEY) {
    wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    gameManagerWithSigner = new ethers.Contract(GAME_MANAGER_ADDRESS, GAME_MANAGER_ABI, wallet);
    if (rewardsManagerContract) {
        rewardsManagerWithSigner = new ethers.Contract(REWARDS_MANAGER_ADDRESS, REWARDS_MANAGER_ABI, wallet);
    }
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
        message: 'Hat NFT, Game Manager & Rewards Server (Ethers v5)',
        contracts: {
            hatNFT: HAT_NFT_ADDRESS,
            gameManager: GAME_MANAGER_ADDRESS,
            rewardsManager: REWARDS_MANAGER_ADDRESS
        },
        rpc: RPC_URL,
        ethersVersion: '5.x',
        security: {
            adminAuthEnabled: !!ADMIN_API_KEY,
            rateLimitEnabled: true,
            ipWhitelistEnabled: ALLOWED_IPS.length > 0,
            requestsPerMinute: RATE_LIMIT_REQUESTS,
            allowedIPs: ALLOWED_IPS.length > 0 ? ALLOWED_IPS.length + ' configured' : 'All IPs allowed'
        },
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
            'GET /leaderboard/top-scores': 'Get top scores within time range',
            'POST /leaderboard/custom': 'Get custom leaderboard for specific players',
            'POST /admin/submit-game': 'Submit game results (requires private key)',
            'POST /admin/toggle-scoring': 'Toggle score ordering mode (requires private key)',
            'POST /admin/distribute-leaderboard-rewards': 'Distribute rewards to flexible winner list'
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
app.post('/admin/submit-game', adminAuth, ipWhitelist, async (req, res) => {
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

        // Check if global rewards are configured and automatically submit results
        let rewardsStatus = null;
        if (rewardsManagerContract) {
            try {
                const isRewardsActive = await rewardsManagerContract.isActive();
                if (isRewardsActive) {
                    console.log(`🎁 Rewards configured for game ${gameId}, auto-submitting results...`);

                    // Sort players by score to determine winners
                    const isDescendingOrder = await gameManagerContract.isDescendingOrder();
                    const playerScores = players.map((player, index) => ({
                        address: player,
                        score: scores[index]
                    }));

                    playerScores.sort((a, b) => {
                        return isDescendingOrder ? b.score - a.score : a.score - b.score;
                    });

                    // Get the top winners based on reward configuration
                    const numberOfWinners = await rewardsManagerContract.numberOfWinners();
                    const winners = playerScores.slice(0, numberOfWinners).map(p => p.address);

                    // Submit results and auto-distribute rewards
                    if (rewardsManagerWithSigner) {
                        try {
                            const rewardsTx = await rewardsManagerWithSigner.submitGameResults(gameId, winners);
                            await rewardsTx.wait();
                            console.log(`✅ Rewards results auto-submitted for game ${gameId}`);

                            // Automatically distribute rewards to all winners
                            console.log(`💰 Auto-distributing rewards for game ${gameId}...`);
                            const distributeTx = await rewardsManagerWithSigner.batchDistributeRewards(gameId);
                            await distributeTx.wait();
                            console.log(`✅ Rewards auto-distributed for game ${gameId}`);

                            rewardsStatus = {
                                submitted: true,
                                distributed: true,
                                winners: winners,
                                submitTxHash: rewardsTx.hash,
                                distributeTxHash: distributeTx.hash
                            };
                        } catch (error) {
                            console.error(`❌ Failed to auto-process rewards: ${error.message}`);
                            rewardsStatus = {
                                submitted: false,
                                distributed: false,
                                error: error.message
                            };
                        }
                    }
                }
            } catch (error) {
                console.log(`ℹ️ No global rewards configured`);
            }
        }

        res.json({
            success: true,
            gameId: gameId,
            transactionHash: tx.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            players: players,
            scores: scores,
            rewards: rewardsStatus,
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
app.post('/admin/toggle-scoring', adminAuth, ipWhitelist, async (req, res) => {
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

// === REWARDS ADMIN ENDPOINTS ===

// Submit game results to rewards manager
app.post('/admin/submit-rewards-results', adminAuth, ipWhitelist, async (req, res) => {
    try {
        if (!rewardsManagerWithSigner) {
            return res.status(403).json({
                error: 'Rewards manager not available'
            });
        }

        const { gameId, winners } = req.body;

        if (gameId === undefined || !Array.isArray(winners)) {
            return res.status(400).json({
                error: 'Invalid request body',
                message: 'Required: gameId, winners[]'
            });
        }

        console.log(`🏆 Submitting game results for game ${gameId}...`);

        const tx = await rewardsManagerWithSigner.submitGameResults(gameId, winners);
        const receipt = await tx.wait();

        console.log(`✅ Game results submitted in block ${receipt.blockNumber}`);

        res.json({
            success: true,
            gameId: gameId,
            winners: winners,
            transactionHash: tx.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString()
        });

    } catch (error) {
        console.error('Error in /admin/submit-rewards-results:', error);
        res.status(500).json({
            error: 'Failed to submit game results',
            message: error.message
        });
    }
});

// Distribute rewards for a game
app.post('/admin/distribute-rewards', adminAuth, ipWhitelist, async (req, res) => {
    try {
        if (!rewardsManagerWithSigner) {
            return res.status(403).json({
                error: 'Rewards manager not available'
            });
        }

        const { gameId, player } = req.body;

        if (gameId === undefined) {
            return res.status(400).json({
                error: 'Invalid request body',
                message: 'Required: gameId, optional: player (if not provided, distributes to all winners)'
            });
        }

        console.log(`💰 Distributing rewards for game ${gameId}...`);

        let tx;
        if (player) {
            // Distribute to specific player
            tx = await rewardsManagerWithSigner.distributeReward(gameId, player);
        } else {
            // Batch distribute to all winners
            tx = await rewardsManagerWithSigner.batchDistributeRewards(gameId);
        }

        const receipt = await tx.wait();
        console.log(`✅ Rewards distributed in block ${receipt.blockNumber}`);

        res.json({
            success: true,
            gameId: gameId,
            player: player || 'all winners',
            transactionHash: tx.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString()
        });

    } catch (error) {
        console.error('Error in /admin/distribute-rewards:', error);
        res.status(500).json({
            error: 'Failed to distribute rewards',
            message: error.message
        });
    }
});

// Distribute leaderboard rewards (flexible winners and amounts)
app.post('/admin/distribute-leaderboard-rewards', adminAuth, ipWhitelist, async (req, res) => {
    try {
        if (!rewardsManagerWithSigner) {
            return res.status(403).json({
                error: 'Rewards manager not available'
            });
        }

        const { winners, amounts, description } = req.body;

        if (!Array.isArray(winners) || !Array.isArray(amounts)) {
            return res.status(400).json({
                error: 'Invalid request body',
                message: 'Required: winners[], amounts[], optional: description'
            });
        }

        if (winners.length !== amounts.length) {
            return res.status(400).json({
                error: 'Arrays length mismatch',
                message: 'winners and amounts arrays must have the same length'
            });
        }

        if (winners.length === 0 || winners.length > 10) {
            return res.status(400).json({
                error: 'Invalid winner count',
                message: 'Must have between 1 and 10 winners'
            });
        }

        // Validate addresses
        for (const address of winners) {
            if (!ethers.utils.isAddress(address)) {
                return res.status(400).json({
                    error: 'Invalid Ethereum address',
                    address: address
                });
            }
        }

        // Validate amounts are positive numbers
        for (const amount of amounts) {
            if (typeof amount !== 'string' && typeof amount !== 'number') {
                return res.status(400).json({
                    error: 'Invalid amount format',
                    message: 'All amounts must be strings or numbers representing wei values'
                });
            }
        }

        console.log(`💰 Distributing leaderboard rewards to ${winners.length} winners...`);
        if (description) console.log(`📝 Description: ${description}`);

        // Convert amounts to BigNumber strings if needed
        const amountStrings = amounts.map(amount => amount.toString());

        const tx = await rewardsManagerWithSigner.distributeLeaderboardRewards(winners, amountStrings);
        const receipt = await tx.wait();

        console.log(`✅ Leaderboard rewards distributed in block ${receipt.blockNumber}`);

        // Calculate total distributed
        const totalDistributed = amountStrings.reduce((sum, amount) => sum + BigInt(amount), 0n);

        res.json({
            success: true,
            description: description || 'Leaderboard rewards distribution',
            winnersCount: winners.length,
            winners: winners,
            amounts: amountStrings,
            totalDistributed: totalDistributed.toString(),
            transactionHash: tx.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in /admin/distribute-leaderboard-rewards:', error);
        res.status(500).json({
            error: 'Failed to distribute leaderboard rewards',
            message: error.message
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

// Time-based top scores leaderboard
app.get('/leaderboard/top-scores', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const hours = parseInt(req.query.hours) || 12;
        const mode = req.query.mode || 'scores'; // 'scores' or 'players'

        if (limit > 100) {
            return res.status(400).json({
                error: 'Limit cannot exceed 100'
            });
        }

        if (hours > 168) { // 1 week max
            return res.status(400).json({
                error: 'Hours cannot exceed 168 (1 week)'
            });
        }

        // Get current scoring mode from contract if available
        let isDescendingOrder = true;
        try {
            if (GAME_MANAGER_ADDRESS !== '0x0000000000000000000000000000000000000000') {
                isDescendingOrder = await gameManagerContract.isDescendingOrder();
            }
        } catch (error) {
            console.log('Could not get scoring mode, using default:', error.message);
        }

        let results;
        let description;

        if (mode === 'players') {
            // Get best score per player within time range
            results = db.getTopPlayersInTimeRange(limit, hours, isDescendingOrder);
            description = `Top ${limit} players by best score in last ${hours} hours`;

            // Format results for players mode
            results = results.map((player, index) => ({
                rank: index + 1,
                address: player.player_address,
                bestScore: player.best_score,
                gamesPlayed: player.games_played,
                equippedHat: player.equipped_hat_id,
                hatType: player.hat_type,
                lastGameTime: player.last_game_time
            }));
        } else {
            // Get all scores within time range (multiple entries per player possible)
            results = db.getTopScoresInTimeRange(limit, hours, isDescendingOrder);
            description = `Top ${limit} scores in last ${hours} hours`;

            // Format results for scores mode
            results = results.map((entry, index) => ({
                rank: index + 1,
                address: entry.player_address,
                score: entry.score,
                gameId: entry.game_id,
                equippedHat: entry.equipped_hat_id,
                hatType: entry.hat_type,
                gameTime: entry.created_at,
                blockNumber: entry.block_number,
                transactionHash: entry.transaction_hash
            }));
        }

        // Get additional stats
        const timeRangeStats = {
            totalGames: db.getGamesInTimeRange(hours).length,
            activePlayers: db.getActivePlayersInTimeRange(hours).active_players
        };

        res.json({
            description: description,
            timeRange: `Last ${hours} hours`,
            mode: mode,
            isDescendingOrder: isDescendingOrder,
            scoringMode: isDescendingOrder ? 'Higher scores better' : 'Lower scores better',
            resultCount: results.length,
            limit: limit,
            stats: timeRangeStats,
            results: results,
            timestamp: new Date().toISOString(),
            query: {
                limit: limit,
                hours: hours,
                mode: mode
            }
        });

    } catch (error) {
        console.error('Error in /leaderboard/top-scores:', error);
        res.status(500).json({
            error: 'Failed to get top scores',
            message: error.message
        });
    }
});

// === PUBLIC REWARDS ENDPOINTS ===

// Get global reward configuration
app.get('/rewards/config', async (req, res) => {
    try {
        if (!rewardsManagerContract) {
            return res.status(503).json({
                error: 'Rewards manager not deployed'
            });
        }

        const isActiveCheck = await rewardsManagerContract.isActive();

        if (!isActiveCheck) {
            return res.status(404).json({
                error: 'No active global rewards configuration found'
            });
        }

        const totalRewardAmountValue = await rewardsManagerContract.totalRewardAmount();
        const numberOfWinnersValue = await rewardsManagerContract.numberOfWinners();

        // Get reward percentages (configurable)
        const rewardPercentages = [];
        if (numberOfWinnersValue >= 1) {
            const percent1 = await rewardsManagerContract.percent1();
            rewardPercentages.push(percent1.toNumber());
        }
        if (numberOfWinnersValue >= 2) {
            const percent2 = await rewardsManagerContract.percent2();
            rewardPercentages.push(percent2.toNumber());
        }
        if (numberOfWinnersValue >= 3) {
            const percent3 = await rewardsManagerContract.percent3();
            rewardPercentages.push(percent3.toNumber());
        }

        res.json({
            tokenType: 'NATIVE', // Core version only supports native ETH
            tokenAddress: '0x0000000000000000000000000000000000000000',
            decimals: 18,
            totalRewardAmount: totalRewardAmountValue.toString(),
            numberOfWinners: numberOfWinnersValue,
            rewardPercentages: rewardPercentages,
            isActive: isActiveCheck,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in /rewards/config:', error);
        res.status(500).json({
            error: 'Failed to get global reward configuration',
            message: error.message
        });
    }
});



// Enhanced ownership verification endpoint
app.post('/verify/ownership', async (req, res) => {
    try {
        const { address, tokenIds } = req.body;

        if (!ethers.utils.isAddress(address)) {
            return res.status(400).json({
                error: 'Invalid Ethereum address',
                address: address
            });
        }

        if (!Array.isArray(tokenIds)) {
            return res.status(400).json({
                error: 'tokenIds must be an array'
            });
        }

        const verificationResults = [];

        for (const tokenId of tokenIds) {
            try {
                const owner = await hatNFTContract.ownerOf(tokenId);
                const isOwned = owner.toLowerCase() === address.toLowerCase();

                verificationResults.push({
                    tokenId: tokenId,
                    isOwned: isOwned,
                    actualOwner: owner,
                    verified: isOwned
                });
            } catch (error) {
                verificationResults.push({
                    tokenId: tokenId,
                    isOwned: false,
                    error: 'Token does not exist or query failed',
                    verified: false
                });
            }
        }

        const allVerified = verificationResults.every(r => r.verified);

        res.json({
            address: address,
            allTokensVerified: allVerified,
            verificationResults: verificationResults,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in /verify/ownership:', error);
        res.status(500).json({
            error: 'Failed to verify ownership',
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
            'GET /leaderboard/top-scores',
            'POST /leaderboard/custom',
            'POST /admin/submit-game',
            'POST /admin/toggle-scoring',
            '--- REWARDS ENDPOINTS ---',
            'POST /admin/submit-rewards-results',
            'POST /admin/distribute-rewards',
            'POST /admin/distribute-leaderboard-rewards',
            'GET /rewards/config',
            'POST /verify/ownership'
        ]
    });
});

// Start server function - can be called programmatically for testing
async function startServer() {
    return new Promise((resolve) => {
        const server = app.listen(PORT, async () => {
            console.log(`🚀 Hat NFT & Game Manager Server running on port ${PORT}`);
            console.log(`📄 HatNFT Contract: ${HAT_NFT_ADDRESS}`);
            console.log(`🎮 GameManager Contract: ${GAME_MANAGER_ADDRESS}`);
            console.log(`💰 RewardsManager Contract: ${REWARDS_MANAGER_ADDRESS}`);
            console.log(`🌐 RPC: ${RPC_URL}`);
            console.log(`⚙️  Using Ethers v5`);
            console.log(`💾 Database: SQLite (pinkhat.db)`);

            // Security status
            console.log(`\n🔒 Security Status:`);
            console.log(`   🔑 Admin Auth: ${ADMIN_API_KEY ? '✅ Enabled' : '❌ Disabled (set ADMIN_API_KEY)'}`);
            console.log(`   🚦 Rate Limiting: ✅ ${RATE_LIMIT_REQUESTS} requests per ${RATE_LIMIT_WINDOW_MS/1000}s`);
            console.log(`   🌐 IP Whitelist: ${ALLOWED_IPS.length > 0 ? `✅ ${ALLOWED_IPS.length} IPs allowed` : '❌ All IPs allowed'}`);
            console.log(`   🔐 Private Key: ${PRIVATE_KEY ? '✅ Configured' : '❌ Not configured (read-only mode)'}`);

            if (!ADMIN_API_KEY) {
                console.log(`\n⚠️  WARNING: Admin endpoints are not secured! Set ADMIN_API_KEY environment variable.`);
            }

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

            resolve(server);
        });
    });
}

// Only start server automatically when run directly (not when imported for testing)
if (require.main === module) {
    startServer();
}

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

module.exports = { app, startServer };