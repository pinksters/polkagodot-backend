# Polkagodot Backend Template

A production-ready Node.js backend template for building games with customizable NFTs on Polkadot Asset Hub with comprehensive player data management.

## 🎮 Perfect For Game Builders

Build your next game with:

- **🎨 Customizable NFT Items** - Skins, weapons, characters, collectibles
- **🏆 Player Progression** - Stats tracking, achievements, leaderboards
- **💎 Asset Ownership** - True ownership verification on Asset Hub
- **⚡ Real-time Sync** - Instant blockchain updates to your game

## 🚀 Quick Start

```bash
npm install
cp config/.env.example .env
# Edit .env with your Asset Hub configuration
npm start
```

Server runs on port 3002 with automatic database initialization.

## 📁 Project Structure

```
polkagodot-backend/
├── src/
│   ├── server/           # Express.js game API
│   └── contracts/        # Smart contracts (Solidity)
├── assets/
│   ├── images/          # Game asset images (PNG, etc.)
│   └── metadata/        # NFT metadata templates (JSON)
├── config/              # Configuration templates
└── data/               # Game database (auto-created)
```

## 🏗️ Architecture

### Smart Contracts (Asset Hub Compatible)

- **[NFT Contract](src/contracts/hat.sol)** - ERC721 for game items/collectibles
- **[Game Manager](src/contracts/GameManager.sol)** - Game logic, player stats, equipment
- **[Rewards Manager](src/contracts/RewardsMinimal.sol)** - Automated reward distribution system

### Game Backend API

Express.js server ([src/server/](src/server/)) providing:

- **Player Management** - Stats, progression, inventory
- **NFT Integration** - Ownership verification, equipment system
- **Game Analytics** - Leaderboards, match history, achievements
- **Real-time Sync** - Blockchain events to database

## ✨ Game Features Ready to Use

- **🎨 NFT Equipment System** - Players equip owned NFTs as game items
- **📊 Player Statistics** - Automatic tracking of wins, scores, games played
- **🏆 Leaderboards** - Real-time rankings and competitive features
- **💰 Automated Rewards** - Instant reward distribution to game winners (PASEO)
- **🔍 Ownership Verification** - Server-side verification of NFT ownership
- **🎁 Configurable Prizes** - Set reward amounts, winner counts, and percentage splits
- **💾 High-Performance Cache** - Lightning-fast queries with SQLite
- **📈 Game Analytics** - Track player behavior and game metrics

## 🛠️ Configuration for Your Game

1. **Environment Setup**:

   ```bash
   cp config/.env.example .env
   ```

2. **Configure Asset Hub** (`.env`):

   ```env
   # Polkadot Asset Hub Configuration
   RPC_URL=wss://polkadot-asset-hub-rpc.polkadot.io
   PRIVATE_KEY=your-game-admin-private-key

   # Your Game Contracts
   HAT_NFT_ADDRESS=0x...        # Your game items contract
   GAME_MANAGER_ADDRESS=0x...   # Your game logic contract
   REWARDS_MANAGER_ADDRESS=0x... # Your rewards distribution contract

   # Server Configuration
   PORT=3002
   ```

3. **Customize for your game** - Update contracts and metadata for your specific game items

## 🏆 Automated Rewards System

The rewards system automatically distributes prizes to game winners without any manual claiming required.

### Setup Rewards

1. **Configure Global Rewards** (on-chain):
   ```solidity
   // Configure rewards: 1 PASEO total, 3 winners, 50%/30%/20% split
   configureGlobalRewards(1000000000000000000, 3, [50, 30, 20])
   ```

2. **Fund the Contract**:
   ```bash
   # Send PASEO to rewards contract address
   # Contract only supports native PASEO tokens
   ```

3. **Automatic Distribution**:
   - When you submit game results via `/admin/submit-game`
   - Winners are automatically determined by scores
   - Rewards are instantly distributed to winner wallets
   - No claiming process needed!

### Features

- ✅ **Native PASEO Support** - Reward in native Paseo testnet tokens
- ✅ **Configurable Splits** - Set custom percentage distributions
- ✅ **Multiple Winners** - Support 1-3 winners per game
- ✅ **Instant Distribution** - No delays or claiming required
- ✅ **Global Configuration** - One setup works for all games
- ✅ **Server Integration** - Fully automated via game submission

## 🎯 Game API Endpoints

### Player Management

- `GET /player/:address/stats` - Player stats, inventory, match history
- `GET /player/:address/equipped` - Currently equipped NFT items
- `GET /leaderboard` - Global player rankings

### NFT Game Items

- `GET /tokens/:address` - NFT items owned by player
- `POST /tokens/batch` - Bulk check item ownership
- `GET /info` - Game contract information

### Game Operations

- `POST /admin/submit-game` - Submit match results (auto-distributes rewards)
- `GET /game/:gameId` - Match details and player performance

### Rewards System

- `GET /rewards/config` - View current reward configuration (amounts, percentages, winners)
- `POST /verify/ownership` - Verify NFT ownership for multiple tokens at once

## 🗂️ Key Files for Game Development

- **[src/server/index.js](src/server/index.js)** - Main game API and blockchain integration
- **[src/server/database.js](src/server/database.js)** - Player data and game history management
- **[assets/metadata/](assets/metadata/)** - NFT metadata templates for game items
- **[config/.env.example](config/.env.example)** - Asset Hub configuration template

## 🚀 Development

```bash
npm run dev          # Development with auto-reload
npm start           # Production game server
```

## 🎨 Customize for Your Game

### Game Items & NFTs

1. **Design your items** - Update metadata in `assets/metadata/`
2. **Add artwork** - Place item images in `assets/images/`
3. **Deploy contracts** - Use templates in `src/contracts/`
4. **Update APIs** - Modify endpoints for your game mechanics

### Player Data & Stats

1. **Define stats** - Modify database schema in `src/server/database.js`
2. **Track metrics** - Add your game's specific tracking
3. **Create leaderboards** - Customize ranking logic for your game

### Game Mechanics

1. **Equipment system** - Customize how NFTs are used in-game
2. **Scoring system** - Implement your game's scoring logic
3. **Player progression** - Add levels, achievements, unlocks

## 🎮 Game Use Cases

Perfect for building:

- **🏎️ Racing games** with collectible cars/skins
- **⚔️ RPG games** with weapons, armor, characters
- **🃏 Trading card games** with collectible cards
- **🏠 Virtual worlds** with land, items, decorations
- **🎯 Competitive games** with unlockable skins/items

## 🌐 Asset Hub Benefits

- **💸 Low transaction fees** for in-game transactions
- **⚡ Fast finality** for responsive gameplay
- **🔗 Polkadot ecosystem** integration
- **🛡️ Enterprise security** with Substrate framework

## 🤝 Contributing

Help make this template better for game builders:

1. Fork the repository
2. Add game-specific features
3. Test with real game scenarios
4. Submit pull requests

## 📄 License

MIT
