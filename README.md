# PinkHat 🎩

A racing game ecosystem built on Polkadot's Paseo testnet featuring NFT hats and comprehensive player tracking.

## 🏗️ Architecture

### Smart Contracts

#### 1. HatNFT Contract
**Address:** `0x324a3b3A6E00E07A7EC13D03d468C257350A3Df9`

ERC721 NFT contract for collectible racing hats with 4 unique types:
- Hawaiian hat
- Cowboy hat  
- Bucket hat
- Traffic cone

**Key Features:**
- Only 4 hats total (one of each type)
- Owner-only minting
- IPFS metadata storage
- Hat type tracking

#### 2. GameManagerLite Contract
**Address:** `0xb4F7A6aF596FF963a00Bf27C9438fB88Abf5f414`

Optimized racing game management contract designed for Paseo's initcode limits:

**Core Features:**
- **Hat Equipment System**: Players equip owned NFT hats (default hat if none equipped)
- **Race Results**: Support for up to 7 players per race
- **Player Statistics**: Best times, total games, wins, equipped hats
- **Event-Driven History**: Complete game history via blockchain events

**Contract Functions:**
```solidity
// Hat Management
function equipHat(uint256 tokenId) external
function playerStats(address player) external view returns (...)

// Game Management (Owner Only)  
function submitGameResult(address[] players, uint256[] times) external

// Queries
function getTotalGames() external view returns (uint256)
```

**Events:**
```solidity
event GameCompleted(uint256 gameId, address winner, uint256 playerCount, address[] players, uint256[] times, uint256[] equippedHats, uint256 timestamp)
event HatEquipped(address indexed player, uint256 indexed tokenId)
event NewPersonalBest(address indexed player, uint256 newBestScore, uint256 gameId)
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
```

## 🏁 Game Mechanics

### Racing System
- **Max Players:** 7 per race
- **Scoring:** Lower time = better (racing game)
- **Winner:** Player with fastest time
- **Hat Snapshots:** Player's equipped hat recorded per game

### Statistics Tracking
- **Personal Bests:** Automatic tracking with game reference
- **Win Counting:** Total first-place finishes
- **Game History:** Complete list of participated games
- **Hat Equipment:** Current equipped hat with metadata

### Data Architecture
- **On-Chain:** Core stats and game results via events
- **Backend:** Event reconstruction for rich queries
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
const HAT_NFT_ADDRESS = '0x324a3b3A6E00E07A7EC13D03d468C257350A3Df9';
const GAME_MANAGER_ADDRESS = '0xb4F7A6aF596FF963a00Bf27C9438fB88Abf5f414';
```

### Run Server
```bash
npm start
# or for development
npm run dev
```

### Smart Contract Deployment
1. Deploy `HatNFT.sol` first
2. Deploy `GameManagerLite.sol` with HatNFT address
3. Update backend configuration

## 📊 Usage Examples

### Equip a Hat
```solidity
// Contract interaction
gameManager.equipHat(2); // Equip hat token ID 2
```

### Submit Game Results (Owner Only)
```solidity
address[] memory players = [0x..., 0x..., 0x...];
uint256[] memory times = [1250, 1340, 1180]; // milliseconds
gameManager.submitGameResult(players, times);
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
GameManagerLite was specifically designed to fit Paseo's 49KB initcode limit by:
- Removing dynamic arrays from storage
- Using events for game history reconstruction
- Minimal view functions
- Optimized data structures

### Backend Event Processing
The API reconstructs complete game history by:
- Querying `GameCompleted` events
- Building player participation lists
- Enriching data with NFT metadata
- Providing paginated responses

## 📝 License

ISC