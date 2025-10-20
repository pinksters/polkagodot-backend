require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const PORT = process.env.METADATA_PORT || 3003;
const MODE = process.env.METADATA_MODE || 'wraparound'; // 'wraparound' or 'random'
const RANDOM_SEED = process.env.HAT_NFT_ADDRESS || 'default-seed'; // Use contract address as seed

const app = express();

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Load base metadata files
const BASE_METADATA_FILES = [1, 2, 3, 4];
const metadataCache = {};


function loadBaseMetadata() {
    console.log('Loading base metadata files...');

    for (const tokenId of BASE_METADATA_FILES) {
        const filePath = path.join(__dirname, `${tokenId}.json`);

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            metadataCache[tokenId] = JSON.parse(content);
            console.log(`Loaded ${tokenId}.json`);
        } catch (error) {
            console.error(`Failed to load ${tokenId}.json:`, error.message);
        }
    }

    console.log(`\nLoaded ${Object.keys(metadataCache).length} base metadata files\n`);
}


function seededRandom(tokenId, seed) {
    const hash = crypto.createHash('sha256')
        .update(`${seed}-${tokenId}`)
        .digest('hex');
    const num = parseInt(hash.substring(0, 8), 16);
    return num;
}


function getBaseTokenId(tokenId, mode) {
    const numBaseTokens = BASE_METADATA_FILES.length;

    if (mode === 'wraparound') {
        const baseId = ((tokenId - 1) % numBaseTokens) + 1;
        return baseId;
    } else if (mode === 'random') {
        const randomValue = seededRandom(tokenId, RANDOM_SEED);
        const baseId = (randomValue % numBaseTokens) + 1;
        return baseId;
    } else {
        // Default to wraparound
        return ((tokenId - 1) % numBaseTokens) + 1;
    }
}


// Token metadata endpoint
app.get('/:tokenId.json', (req, res) => {
    try {
        const tokenId = parseInt(req.params.tokenId);

        // Validate token ID
        if (isNaN(tokenId) || tokenId < 1) {
            return res.status(400).json({
                error: 'Invalid token ID',
                message: 'Token ID must be a positive integer'
            });
        }

        // Determine which base metadata to use
        const baseTokenId = getBaseTokenId(tokenId, MODE);

        // Get base metadata
        const metadata = metadataCache[baseTokenId];

        if (!metadata) {
            return res.status(404).json({
                error: 'Metadata not found',
                message: `Base metadata file ${baseTokenId}.json not loaded`,
                tokenId: tokenId,
                baseTokenId: baseTokenId
            });
        }

        console.log(`Token ${tokenId} → Base ${baseTokenId} (${MODE} mode)`);
        res.json(metadata);

    } catch (error) {
        console.error('Error serving metadata:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});


// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'OK',
        message: 'Pinkhat Metadata Server',
        mode: MODE,
        baseMetadataFiles: BASE_METADATA_FILES.length,
        loadedFiles: Object.keys(metadataCache).length,
        randomSeed: MODE === 'random' ? RANDOM_SEED.substring(0, 10) + '...' : 'N/A',
        endpoints: {
            'GET /:tokenId.json': 'Get metadata for a specific token ID'
        }
    });
});


app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        availableEndpoints: [
            'GET /:tokenId.json - Get metadata for token'
        ]
    });
});


function start() {
    loadBaseMetadata();

    if (Object.keys(metadataCache).length === 0) {
        console.error('No metadata files loaded!');
        process.exit(1);
    }

    app.listen(PORT, () => {
        console.log('Hat NFT Metadata Server running on port ${PORT}');
        console.log(`Metadata wraparound mode: ${MODE.toUpperCase()}`);
        if (MODE === 'random') {
            console.log(`Seed: ${RANDOM_SEED.substring(0, 20)}...`);
        }
        console.log(`Base Metadata: ${Object.keys(metadataCache).length} files loaded`);
        console.log();
    });
}


process.on('SIGINT', () => {
    console.log('\nShutting down metadata server...');
    process.exit(0);
});


process.on('SIGTERM', () => {
    console.log('\nShutting down metadata server...');
    process.exit(0);
});

start();

module.exports = app;