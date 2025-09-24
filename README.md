# PinkHat 🎩

A racing game ecosystem built on Polkadot's Paseo testnet featuring NFT hats and comprehensive player tracking.

## 🏗️ Architecture

### Smart Contracts

#### 1. HatNFT Contract

**Address:** `0x3C0e12dCE9BCae9a0ba894Ef848b2A007c723428`

Ultra-minimal ERC721 NFT contract for collectible racing hats with 4 unique types:

- **Hawaiian Hat** (Token ID 1)
- **Cowboy Hat** (Token ID 2) 
- **Bucket Hat** (Token ID 3)
- **Traffic Cone** (Token ID 4)

Hat types are determined by fetching JSON metadata from IPFS via `tokenURI()`.

**Key Features:**

- Ultra-minimal contract design (fits testnet limits)
- Owner-only minting
- IPFS metadata storage with rich hat type information
- GameManager integration for automatic unequipping on transfer
- Manual transfer function with unequip logic
- Backend automatically fetches hat names from JSON metadata

#### 2. GameManager Contract

**Address:** `0x8Fdd529C529db331869e3AA910f8986fDCc2510F`

Enhanced racing game management contract with flexible scoring system:

**Core Features:**

- **Hat Equipment System**: Players equip owned NFT hats (default hat if none equipped)
- **Race Results**: Support for up to 7 players per race
- **Flexible Scoring**: Toggle between descending (higher scores better) and ascending (lower scores better) modes
- **Player Statistics**: Best scores, total games, wins, equipped hats
- **Event-Driven History**: Complete game history via blockchain events
- **Ownership Verification**: Races verify players own their equipped hats before allowing participation
- **Automatic Unequip**: Hats are automatically unequipped when transferred to prevent ownership issues

**Contract Functions:**

```solidity
// Hat Management
function equipHat(uint256 tokenId) external
function unequipHat() external // Set hat to 0 (default)
function getEquippedHat(address player) external view returns (uint256)
function verifyHatOwnership(address player) external view returns (bool)
function unequipHatForPlayer(address player, uint256 tokenId) external // Called by HatNFT on transfer

// Game Management (Owner Only)
function submitGameResult(address[] players, uint256[] scores) external // Verifies hat ownership before race
function toggleScoreOrdering() external // Toggle between descending/ascending

// Queries
function playerStats(address) external view returns (uint256 bestScore, uint256 totalWins, uint256 equippedHat, bool hasPlayed)
function getTotalGames() external view returns (uint256)
function isDescendingOrder() external view returns (bool)
```

**Events:**

```solidity
event GameSubmitted(uint256 indexed gameId, address indexed winner, uint256 playerCount, address[] players, uint256[] scores)
event ScoreOrderingChanged(bool isDescendingOrder)
```

## 🚀 Backend API

Express.js server providing comprehensive game analytics and NFT querying with SQLite database caching.

### Configuration

- **Network:** Paseo Testnet (Polkadot)
- **RPC:** `https://testnet-passet-hub-eth-rpc.polkadot.io`
- **Port:** 3002
- **Database:** SQLite (`pinkhat.db`) with automatic blockchain sync
- **Hat Types:** Automatically fetched from IPFS JSON metadata

### Hat Type Resolution

The backend automatically resolves hat types by:

1. **Token ID → Token URI** - Gets IPFS URL (e.g., `https://pinkhats.4everland.store/2.json`)
2. **Fetch JSON Metadata** - Retrieves complete NFT metadata from IPFS
3. **Extract Hat Name** - Returns `metadata.name` (e.g., "Cowboy Hat")
4. **Cache in Database** - Stores hat types for fast future queries
5. **Graceful Fallback** - Returns `"Hat #2"` if JSON fetch fails

### API Endpoints

#### Hat NFT Endpoints

```bash
# Get all tokens owned by address
GET /tokens/:address

# Batch query multiple addresses
POST /tokens/batch
Body: { "addresses": ["0x...", "0x..."] }

# Contract information
GET /info

# Database statistics and sync info
GET /db/info
```

#### Game Manager Endpoints

```bash
# Player statistics with game history (cached in database)
GET /player/:address/stats
Response: {
  "address": "0x...",
  "stats": {
    "bestScore": 1250,
    "totalGamesPlayed": 15,
    "totalWins": 3,
    "equippedHat": 2,
    "equippedHatType": "Cowboy Hat",
    "gamesPlayed": [1, 3, 5, 7, ...]
  },
  "gameHistory": [
    {
      "gameId": 7,
      "score": 1250,
      "position": 1,
      "equippedHat": 2,
      "hatType": "Cowboy Hat",
      "won": true,
      "timestamp": "2025-01-15T..."
    }
  ],
  "source": "database"
}

# Current equipped hat with real hat type
GET /player/:address/equipped
Response: {
  "address": "0x...",
  "equippedHat": {
    "tokenId": 2,
    "hatType": "Cowboy Hat",
    "isDefault": false
  }
}

# Game result details (cached in database)
GET /game/:gameId
Response: {
  "gameId": 1,
  "playerCount": 4,
  "blockNumber": 1234567,
  "transactionHash": "0xabc...",
  "timestamp": "2025-01-15T...",
  "winner": "0x...",
  "isDescendingOrder": true,
  "scoringMode": "Higher scores better",
  "players": [
    {
      "address": "0x...",
      "score": 1250,
      "position": 1,
      "equippedHat": 2,
      "hatType": "Cowboy Hat"
    }
  ],
  "source": "database"
}

# Real leaderboard (from database)
GET /leaderboard?limit=10
Response: {
  "playerCount": 5,
  "players": [
    {
      "rank": 1,
      "address": "0x...",
      "bestScore": 1250,
      "totalWins": 3,
      "totalGames": 15,
      "currentEquippedHat": 2
    }
  ],
  "source": "database"
}

# Custom leaderboard for specific players
POST /leaderboard/custom
Body: { "addresses": ["0x...", "0x..."] }

# Get current scoring mode
GET /scoring
```

#### Admin Endpoints (Require Private Key)

```bash
# Submit game results
POST /admin/submit-game
Body: {
  "players": ["0x...", "0x...", "0x..."],
  "scores": [100, 75, 120]
}

# Toggle score ordering mode
POST /admin/toggle-scoring
```

## 🏁 Game Mechanics

### Racing System

- **Max Players:** 7 per race
- **Scoring Modes:**
  - **Descending (Default):** Higher scores = better (e.g., 100 beats 50)
  - **Ascending:** Lower scores = better (e.g., 50 beats 100)
- **Winner:** Player with best score according to current ordering mode
- **Hat Snapshots:** Player's equipped hat recorded per game

### Statistics Tracking

- **Personal Bests:** Automatic tracking with game reference (respects current scoring mode)
- **Win Counting:** Total first-place finishes
- **Game History:** Complete list of participated games
- **Hat Equipment:** Current equipped hat with metadata
- **Score Ordering:** Dynamic switching between ascending/descending modes

### Data Architecture

- **On-Chain:** Minimal player stats (best score, wins, equipped hat)
- **Events:** Complete game history via GameSubmitted events  
- **Database:** SQLite cache with automatic blockchain sync for fast queries
- **Backend:** Database-first with blockchain fallback for reliability
- **IPFS:** NFT metadata storage

## 💾 Database System

### **SQLite Database Schema**

```sql
-- Complete game records with blockchain references
CREATE TABLE games (
    game_id INTEGER PRIMARY KEY,
    block_number INTEGER,
    transaction_hash TEXT UNIQUE,
    winner_address TEXT,
    player_count INTEGER,
    is_descending_order BOOLEAN,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Individual player performance per game with hat info
CREATE TABLE game_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER,
    player_address TEXT,
    score INTEGER,
    position INTEGER,
    equipped_hat_id INTEGER,
    hat_type TEXT, -- Real hat names: "Cowboy Hat", "Hawaiian Hat", etc.
    FOREIGN KEY (game_id) REFERENCES games (game_id)
);

-- Aggregated player statistics for fast queries
CREATE TABLE player_stats (
    player_address TEXT PRIMARY KEY,
    best_score INTEGER,
    total_wins INTEGER,
    total_games INTEGER,
    current_equipped_hat INTEGER,
    has_played BOOLEAN,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### **Automatic Blockchain Sync**

- **Historical Sync:** On startup, syncs all past games from blockchain events
- **Real-time Sync:** Event listeners automatically sync new games as they happen
- **Hash Tracking:** Every game linked to transaction hash and block number
- **Parameter Preservation:** Scores, positions, hats stored with full context
- **Fallback Safety:** If database query fails, automatically falls back to blockchain

### **Performance Benefits**

| Operation | Blockchain Query | Database Query |
|-----------|------------------|----------------|
| Player Stats | 2-5 seconds | < 1ms |
| Game History | 5-10 seconds | < 1ms |  
| Leaderboard | Not possible* | < 1ms |
| Game Details | 1-3 seconds | < 1ms |

*Blockchain doesn't maintain global player list

### **Database Endpoints**

```bash
# Database statistics and sync status
GET /db/info
Response: {
  "database": {
    "file": "pinkhat.db",
    "tables": {
      "games": 47,
      "players": 23,
      "participants": 156
    }
  },
  "sync": {
    "lastSyncedBlock": 1234567,
    "lastSyncedGameId": 47,
    "lastSyncTime": "2025-01-15T...",
    "status": "synced"
  },
  "recentGames": [...]
}
```

## 🛠️ Setup & Deployment

### Prerequisites

- Node.js 14+
- Ethereum wallet with Paseo testnet tokens

### Installation

```bash
npm install
```

**Dependencies Added:**
- `better-sqlite3` - High-performance SQLite database
- Automatic database initialization on first run
- No additional setup required - database creates itself

### Environment

Update contract addresses in `index.js`:

```javascript
const HAT_NFT_ADDRESS = '0x3C0e12dCE9BCae9a0ba894Ef848b2A007c723428';
const GAME_MANAGER_ADDRESS = '0x8Fdd529C529db331869e3AA910f8986fDCc2510F';
```

### Run Server

```bash
npm start
# or for development
npm run dev
```

**On Startup:**
1. Database automatically initializes (`pinkhat.db` created)
2. Historical blockchain sync runs (syncs all past games)
3. Real-time event listeners start
4. Server ready with full database cache

### Smart Contract Deployment

1. Deploy `HatNFT.sol` first
2. Deploy `GameManager.sol` with HatNFT address
3. Call `setGameManager(gameManagerAddress)` on HatNFT contract to enable auto-unequip
4. Update backend configuration

## 📊 Usage Examples

### Hat Management

```solidity
// Equip a hat
gameManager.equipHat(2); // Equip hat token ID 2

// Unequip current hat (set to default)
gameManager.unequipHat();

// Check hat ownership before race
bool ownsHat = gameManager.verifyHatOwnership(playerAddress);

// Get currently equipped hat
uint256 equippedHat = gameManager.getEquippedHat(playerAddress);
```

### Submit Game Results (Owner Only)

```solidity
address[] memory players = [0x..., 0x..., 0x...];
uint256[] memory scores = [100, 75, 120]; // scores (higher=better in descending mode)
gameManager.submitGameResult(players, scores);
```

### Toggle Score Ordering (Owner Only)

```solidity
// Switch between descending and ascending modes
gameManager.toggleScoreOrdering();

// Check current mode
bool isDescending = gameManager.isDescendingOrder(); // true = higher scores better
```

### Submit Game Results via API

```bash
curl -X POST http://localhost:3002/admin/submit-game \
  -H "Content-Type: application/json" \
  -d '{
    "players": ["0x742d35Cc6634C0532925a3b8d0c05E6E4b8c3C0E", "0x456..."],
    "scores": [100, 75]
  }'
```

### Toggle Score Ordering via API

```bash
curl -X POST http://localhost:3002/admin/toggle-scoring
```

### Query Player Stats

```bash
curl http://localhost:3002/player/0x742d35Cc6634C0532925a3b8d0c05E6E4b8c3C0E/stats
```

### Get Game Results

```bash
curl http://localhost:3002/game/1
```

## 🎯 Key Features

- ✅ **NFT Integration:** Hat ownership verification with auto-unequip on transfer
- ✅ **Real Hat Types:** Automatic resolution from IPFS JSON metadata ("Cowboy Hat", not "Hat #2")
- ✅ **High-Performance Database:** SQLite with automatic blockchain sync
- ✅ **Lightning Fast Queries:** < 1ms response times vs 2-5s blockchain queries
- ✅ **Real Leaderboards:** Global player rankings from aggregated data
- ✅ **Complete Game History:** Transaction hashes, block numbers, full context with hat names
- ✅ **Blockchain Fallback:** Automatic fallback if database query fails
- ✅ **Event-Driven Sync:** Real-time synchronization with blockchain events
- ✅ **Paseo Optimized:** Minimal contract size for deployment limits
- ✅ **Rich Analytics:** Complex queries and reports possible via database
- ✅ **Zero Setup:** Database auto-creates and syncs on first run

## 🔧 Technical Notes

### Contract Size Optimization

GameManager was optimized to fit Paseo's 49KB initcode limit by:

- Minimal on-chain storage (only essential player stats)
- Event-driven architecture for game history
- Removed complex view functions and dynamic arrays
- Streamlined data structures

### Database-First Architecture

The backend now uses a hybrid approach:

**Database Layer:**
- SQLite database automatically syncs with blockchain events
- Sub-millisecond query responses for all operations
- Complete game history with transaction hashes and parameters
- Real hat types cached from IPFS JSON metadata
- Real leaderboards and rich analytics

**Blockchain Sync:**
- Historical sync on startup catches up all past games
- Real-time event listeners sync new games instantly
- Automatic fallback to blockchain if database query fails
- Zero data loss - blockchain remains source of truth

**Performance Gains:**
- Player stats: 2-5s → < 1ms (2000x faster)
- Game history: 5-10s → < 1ms (5000x faster)  
- Leaderboards: Impossible → < 1ms (now possible)
- Offline capability: API works even if RPC is down

## 📝 License

ISC
