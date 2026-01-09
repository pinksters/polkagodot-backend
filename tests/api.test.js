const request = require('supertest');

const API_KEY = 'test-admin-key';

// Get the app from global (set by setup.js after server starts)
const getApp = () => {
    const { app } = require('../src/server/index');
    return app;
};

describe('Health Check', () => {
    test('GET / returns server info', async () => {
        const res = await request(getApp()).get('/');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('OK');
    });

    test('GET /info returns contract addresses', async () => {
        const res = await request(getApp()).get('/info');
        if (res.status !== 200) {
            console.log('GET /info error response:', res.body);
        }
        expect(res.status).toBe(200);
        expect(res.body.contracts).toBeDefined();
    });

    test('GET /db/info returns database status', async () => {
        const res = await request(getApp()).get('/db/info');
        expect(res.status).toBe(200);
    });
});

describe('Token Endpoints', () => {
    test('GET /tokens/:address returns array for valid address', async () => {
        const address = global.testSigners[1].address;
        const res = await request(getApp()).get(`/tokens/${address}`);
        expect(res.status).toBe(200);
        expect(res.body.address).toBe(address);
        expect(Array.isArray(res.body.tokens)).toBe(true);
    });

    test('GET /tokens/:address returns 400 for invalid address', async () => {
        const res = await request(getApp()).get('/tokens/invalid-address');
        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
    });

    test('POST /tokens/batch validates input', async () => {
        const res = await request(getApp())
            .post('/tokens/batch')
            .send({ addresses: 'not-an-array' });
        expect(res.status).toBe(400);
    });

    test('POST /tokens/batch returns tokens for multiple addresses', async () => {
        const addresses = [
            global.testSigners[1].address,
            global.testSigners[2].address
        ];
        const res = await request(getApp())
            .post('/tokens/batch')
            .send({ addresses });
        expect(res.status).toBe(200);
        expect(res.body.results).toBeDefined();
    });
});

describe('Admin Endpoints - Authentication', () => {
    test('POST /admin/submit-game returns 401 without API key', async () => {
        const res = await request(getApp())
            .post('/admin/submit-game')
            .send({ players: [], scores: [] });
        expect(res.status).toBe(401);
    });

    test('POST /admin/submit-game returns 401 with invalid API key', async () => {
        const res = await request(getApp())
            .post('/admin/submit-game')
            .set('X-API-Key', 'wrong-key')
            .send({ players: [], scores: [] });
        expect(res.status).toBe(401);
    });

    test('POST /admin/toggle-scoring returns 401 without API key', async () => {
        const res = await request(getApp())
            .post('/admin/toggle-scoring');
        expect(res.status).toBe(401);
    });
});

describe('Admin Endpoints - Game Submission', () => {
    test('POST /admin/submit-game validates empty arrays', async () => {
        const res = await request(getApp())
            .post('/admin/submit-game')
            .set('X-API-Key', API_KEY)
            .send({ players: [], scores: [] });
        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
    });

    test('POST /admin/submit-game validates array length mismatch', async () => {
        const res = await request(getApp())
            .post('/admin/submit-game')
            .set('X-API-Key', API_KEY)
            .send({
                players: [global.testSigners[1].address],
                scores: [100, 200] // Different length
            });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('mismatch');
    });

    test('POST /admin/submit-game validates player addresses', async () => {
        const res = await request(getApp())
            .post('/admin/submit-game')
            .set('X-API-Key', API_KEY)
            .send({
                players: ['invalid-address', global.testSigners[1].address],
                scores: [100, 200]
            });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('Invalid');
    });

    test('POST /admin/submit-game submits game successfully', async () => {
        const players = [
            global.testSigners[1].address,
            global.testSigners[2].address,
            global.testSigners[3].address
        ];
        const scores = [150, 120, 90];

        const res = await request(getApp())
            .post('/admin/submit-game')
            .set('X-API-Key', API_KEY)
            .send({ players, scores });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.gameId).toBeDefined();
        expect(res.body.transactionHash).toBeDefined();
    }, 30000); // 30 second timeout for blockchain transaction
});

describe('Scoring', () => {
    test('GET /scoring returns current scoring mode', async () => {
        const res = await request(getApp()).get('/scoring');
        expect(res.status).toBe(200);
        expect(typeof res.body.isDescendingOrder).toBe('boolean');
    });

    test('POST /admin/toggle-scoring changes scoring mode', async () => {
        // Get current mode
        const before = await request(getApp()).get('/scoring');
        const wasdescending = before.body.isDescendingOrder;

        // Toggle
        const toggleRes = await request(getApp())
            .post('/admin/toggle-scoring')
            .set('X-API-Key', API_KEY);
        expect(toggleRes.status).toBe(200);

        // Check it changed
        const after = await request(getApp()).get('/scoring');
        expect(after.body.isDescendingOrder).toBe(!wasdescending);
    }, 30000);
});

describe('Leaderboard', () => {
    test('GET /leaderboard returns valid response structure', async () => {
        const res = await request(getApp()).get('/leaderboard');
        expect(res.status).toBe(200);
        // Must have players array (may be empty on fresh deployment)
        expect(res.body.players).toBeDefined();
        expect(Array.isArray(res.body.players)).toBe(true);
        // If players exist, verify structure
        if (res.body.players.length > 0) {
            const player = res.body.players[0];
            expect(player.address).toBeDefined();
        }
    });

    test('GET /leaderboard/top-scores returns results array', async () => {
        const res = await request(getApp()).get('/leaderboard/top-scores');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.results)).toBe(true);
    });

    test('GET /leaderboard/top-scores accepts limit parameter', async () => {
        const res = await request(getApp()).get('/leaderboard/top-scores?limit=5');
        expect(res.status).toBe(200);
        expect(res.body.results.length).toBeLessThanOrEqual(5);
    });
});

describe('Player Stats', () => {
    test('GET /player/:address/stats returns player data', async () => {
        const address = global.testSigners[1].address;
        const res = await request(getApp()).get(`/player/${address}/stats`);
        expect(res.status).toBe(200);
        expect(res.body.address.toLowerCase()).toBe(address.toLowerCase());
    });

    test('GET /player/:address/stats returns 400 for invalid address', async () => {
        const res = await request(getApp()).get('/player/invalid/stats');
        expect(res.status).toBe(400);
    });

    test('GET /player/:address/equipped returns equipped hat info', async () => {
        const address = global.testSigners[1].address;
        const res = await request(getApp()).get(`/player/${address}/equipped`);
        expect(res.status).toBe(200);
        expect(res.body.address.toLowerCase()).toBe(address.toLowerCase());
    });
});

describe('Game Details', () => {
    test('GET /game/:gameId returns game info for valid game', async () => {
        // Game 1 should exist from the submit-game test
        const res = await request(getApp()).get('/game/1');
        expect(res.status).toBe(200);
        expect(res.body.gameId).toBe(1);
    });

    test('GET /game/:gameId returns 404 for non-existent game', async () => {
        const res = await request(getApp()).get('/game/99999');
        expect(res.status).toBe(404);
    });
});

describe('Rewards Config', () => {
    test('GET /rewards/config returns 404 when not configured', async () => {
        const res = await request(getApp()).get('/rewards/config');
        // Rewards are NOT configured in test setup, so must return 404
        expect(res.status).toBe(404);
    });
});

describe('Reward Distribution', () => {
    test('POST /admin/distribute-leaderboard-rewards requires API key', async () => {
        const res = await request(getApp())
            .post('/admin/distribute-leaderboard-rewards')
            .send({});
        expect(res.status).toBe(401);
    });

    test('POST /admin/distribute-leaderboard-rewards validates input', async () => {
        const res = await request(getApp())
            .post('/admin/distribute-leaderboard-rewards')
            .set('X-API-Key', API_KEY)
            .send({});
        expect(res.status).toBe(400);
    });

    test('POST /admin/distribute-leaderboard-rewards validates array lengths', async () => {
        const res = await request(getApp())
            .post('/admin/distribute-leaderboard-rewards')
            .set('X-API-Key', API_KEY)
            .send({
                winners: [global.testSigners[1].address],
                amounts: ['1000000000000000000', '2000000000000000000'] // Mismatched lengths
            });
        expect(res.status).toBe(400);
    });

    test('POST /admin/distribute-leaderboard-rewards distributes rewards', async () => {
        const res = await request(getApp())
            .post('/admin/distribute-leaderboard-rewards')
            .set('X-API-Key', API_KEY)
            .send({
                winners: [global.testSigners[1].address, global.testSigners[2].address],
                amounts: ['1000000000000000', '500000000000000'], // 0.001 and 0.0005 ETH
                description: 'Test reward distribution'
            });

        // Must succeed - RewardsManager is funded with 1 ETH in setup.js
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.transactionHash).toBeDefined();
    }, 30000);
});

describe('Ownership Verification', () => {
    test('POST /verify/ownership validates input', async () => {
        const res = await request(getApp())
            .post('/verify/ownership')
            .send({});
        expect(res.status).toBe(400);
    });

    test('POST /verify/ownership checks token ownership', async () => {
        const res = await request(getApp())
            .post('/verify/ownership')
            .send({
                address: global.testSigners[1].address,
                tokenIds: [1, 2, 3]
            });
        expect(res.status).toBe(200);
        expect(res.body.verificationResults).toBeDefined();
        expect(res.body.allTokensVerified).toBeDefined();
    });
});
