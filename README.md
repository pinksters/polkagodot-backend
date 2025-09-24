# PinkHat 🎩

A racing game ecosystem built on Polkadot's Paseo testnet featuring NFT hats and comprehensive player tracking.

## 🏗️ Architecture

### Smart Contracts

#### 1. HatNFT Contract

**Address:** `0x3C0e12dCE9BCae9a0ba894Ef848b2A007c723428`

ERC721 NFT contract for collectible racing hats with 4 unique types:

- Hawaiian hat
- Cowboy hat
- Bucket hat
- Traffic cone

**Key Features:**

- Ultra-minimal contract design (fits testnet limits)
- Owner-only minting
- IPFS metadata storage
- GameManager integration for automatic unequipping on transfer
- Manual transfer function with unequip logic

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

Express.js server providing comprehensive game analytics and NFT querying.

### Configuration

- **Network:** Paseo Testnet (Polkadot)
- **RPC:** `https://testnet-passet-hub-eth-rpc.polkadot.io`
- **Port:** 3002

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
```

#### Game Manager Endpoints

```bash
# Player statistics with game history
GET /player/:address/stats
Response: {
  "address": "0x...",
  "stats": {
    "bestScore": 1250,
    "totalGamesPlayed": 15,
    "totalWins": 3,
    "equippedHat": 2,
    "equippedHatType": "Cowboy hat",
    "gamesPlayed": [1, 3, 5, 7, ...]
  }
}

# Current equipped hat
GET /player/:address/equipped

# Game result details
GET /game/:gameId
Response: {
  "gameId": 1,
  "playerCount": 4,
  "winner": "0x...",
  "players": [
    {
      "address": "0x...",
      "time": 1250,
      "equippedHat": 2,
      "hatType": "Cowboy hat",
      "position": 1
    }
  ]
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
- **Backend:** Event reconstruction for game history and analytics
- **IPFS:** NFT metadata storage

## 🛠️ Setup & Deployment

### Prerequisites

- Node.js 14+
- Ethereum wallet with Paseo testnet tokens

### Installation

```bash
npm install
```

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

- ✅ **NFT Integration:** Hat ownership verification
- ✅ **Comprehensive Tracking:** Complete player statistics
- ✅ **Event-Driven:** Blockchain event reconstruction
- ✅ **Paseo Optimized:** Minimal contract size for deployment
- ✅ **Rich API:** Full game analytics via REST endpoints
- ✅ **Real-time Updates:** Live game result processing

## 🔧 Technical Notes

### Contract Size Optimization

GameManager was optimized to fit Paseo's 49KB initcode limit by:

- Minimal on-chain storage (only essential player stats)
- Event-driven architecture for game history
- Removed complex view functions and dynamic arrays
- Streamlined data structures

### Backend Event Processing

The API reconstructs complete game history by:

- Querying `GameSubmitted` events for game data
- Building player participation lists from events
- Enriching data with current hat metadata
- Providing real-time analytics

## 📝 License

ISC
