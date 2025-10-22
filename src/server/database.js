const Database = require('better-sqlite3');
const path = require('path');

class GameDatabase {
    constructor(dbPath = path.join(__dirname, '../../data/pinkhat.db')) {
        this.db = new Database(dbPath);
        this.initializeTables();
        console.log(`📄 Database initialized: ${dbPath}`);
    }

    initializeTables() {
        // Enable foreign keys
        this.db.pragma('foreign_keys = ON');

        // Games table - stores complete game information with blockchain references
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS games (
                game_id INTEGER PRIMARY KEY,
                block_number INTEGER,
                transaction_hash TEXT UNIQUE,
                winner_address TEXT,
                player_count INTEGER,
                is_descending_order BOOLEAN,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Game participants - stores each player's performance in each game
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS game_participants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id INTEGER,
                player_address TEXT,
                score INTEGER,
                position INTEGER,
                equipped_hat_id INTEGER,
                hat_type TEXT,
                FOREIGN KEY (game_id) REFERENCES games (game_id)
            )
        `);

        // Player stats aggregation - fast lookup for current player stats
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS player_stats (
                player_address TEXT PRIMARY KEY,
                best_score INTEGER,
                total_wins INTEGER,
                total_games INTEGER,
                current_equipped_hat INTEGER,
                has_played BOOLEAN DEFAULT FALSE,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Sync state - tracks blockchain sync progress
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sync_state (
                id INTEGER PRIMARY KEY DEFAULT 1,
                last_synced_block INTEGER DEFAULT 0,
                last_synced_game_id INTEGER DEFAULT 0,
                last_sync_time DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create indexes for performance
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_game_participants_player ON game_participants(player_address);
            CREATE INDEX IF NOT EXISTS idx_game_participants_game ON game_participants(game_id);
            CREATE INDEX IF NOT EXISTS idx_games_block ON games(block_number);
            CREATE INDEX IF NOT EXISTS idx_games_tx ON games(transaction_hash);
        `);

        // Initialize sync state if empty
        const syncState = this.db.prepare('SELECT COUNT(*) as count FROM sync_state').get();
        if (syncState.count === 0) {
            this.db.prepare('INSERT INTO sync_state (id, last_synced_block, last_synced_game_id) VALUES (1, 0, 0)').run();
        }
    }

    // === GAME METHODS ===

    insertGame(gameData) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO games 
            (game_id, block_number, transaction_hash, winner_address, player_count, is_descending_order) 
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        return stmt.run(
            gameData.gameId,
            gameData.blockNumber,
            gameData.transactionHash,
            gameData.winner,
            gameData.playerCount,
            gameData.isDescendingOrder ? 1 : 0
        );
    }

    insertGameParticipant(participantData) {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO game_participants 
            (game_id, player_address, score, position, equipped_hat_id, hat_type) 
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        return stmt.run(
            participantData.gameId,
            participantData.playerAddress,
            participantData.score,
            participantData.position,
            participantData.equippedHatId,
            participantData.hatType
        );
    }

    getGame(gameId) {
        const gameStmt = this.db.prepare('SELECT * FROM games WHERE game_id = ?');
        const participantsStmt = this.db.prepare('SELECT * FROM game_participants WHERE game_id = ? ORDER BY position');
        
        const game = gameStmt.get(gameId);
        if (!game) return null;
        
        const participants = participantsStmt.all(gameId);
        
        return {
            ...game,
            participants
        };
    }

    getAllGames(limit = 50, offset = 0) {
        const stmt = this.db.prepare(`
            SELECT * FROM games 
            ORDER BY game_id DESC 
            LIMIT ? OFFSET ?
        `);
        return stmt.all(limit, offset);
    }

    // === PLAYER METHODS ===

    upsertPlayerStats(statsData) {
        const stmt = this.db.prepare(`
            INSERT INTO player_stats 
            (player_address, best_score, total_wins, total_games, current_equipped_hat, has_played, last_updated) 
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(player_address) DO UPDATE SET
                best_score = excluded.best_score,
                total_wins = excluded.total_wins,
                total_games = excluded.total_games,
                current_equipped_hat = excluded.current_equipped_hat,
                has_played = excluded.has_played,
                last_updated = CURRENT_TIMESTAMP
        `);
        
        return stmt.run(
            statsData.playerAddress,
            statsData.bestScore,
            statsData.totalWins,
            statsData.totalGames,
            statsData.currentEquippedHat,
            statsData.hasPlayed ? 1 : 0
        );
    }

    getPlayerStats(playerAddress) {
        const statsStmt = this.db.prepare('SELECT * FROM player_stats WHERE player_address = ?');
        const gamesStmt = this.db.prepare(`
            SELECT g.game_id, g.created_at, gp.score, gp.position, gp.equipped_hat_id, gp.hat_type
            FROM game_participants gp
            JOIN games g ON gp.game_id = g.game_id
            WHERE gp.player_address = ?
            ORDER BY g.game_id DESC
        `);
        
        const stats = statsStmt.get(playerAddress);
        const games = gamesStmt.all(playerAddress);
        
        return {
            stats,
            games
        };
    }

    getLeaderboard(limit = 10) {
        const stmt = this.db.prepare(`
            SELECT * FROM player_stats 
            WHERE has_played = TRUE 
            ORDER BY total_wins DESC, best_score DESC 
            LIMIT ?
        `);
        return stmt.all(limit);
    }

    // === SYNC METHODS ===

    updateSyncState(lastBlock, lastGameId) {
        const stmt = this.db.prepare(`
            UPDATE sync_state 
            SET last_synced_block = ?, last_synced_game_id = ?, last_sync_time = CURRENT_TIMESTAMP 
            WHERE id = 1
        `);
        return stmt.run(lastBlock, lastGameId);
    }

    getSyncState() {
        const stmt = this.db.prepare('SELECT * FROM sync_state WHERE id = 1');
        return stmt.get();
    }

    // === UTILITY METHODS ===

    gameExists(gameId) {
        const stmt = this.db.prepare('SELECT COUNT(*) as count FROM games WHERE game_id = ?');
        return stmt.get(gameId).count > 0;
    }

    getPlayerGameHistory(playerAddress) {
        const stmt = this.db.prepare(`
            SELECT g.game_id, g.created_at, gp.score, gp.position, gp.equipped_hat_id, gp.hat_type,
                   g.winner_address = gp.player_address as won
            FROM game_participants gp
            JOIN games g ON gp.game_id = g.game_id
            WHERE gp.player_address = ?
            ORDER BY g.game_id DESC
        `);
        return stmt.all(playerAddress);
    }

    close() {
        this.db.close();
    }
}

module.exports = GameDatabase;
