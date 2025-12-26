# Getting Started with PolkaGodot on Paseo Asset Hub

This guide walks you through setting up and running the PolkaGodot demo on Paseo Asset Hub testnet. We'll cover getting test tokens, deploying your contracts, and getting everything configured.

## What is Paseo Asset Hub?

Paseo Asset Hub (or Paseo Hub) is Polkadot's dedicated testnet for smart contract development. It mirrors the Asset Hub runtime, giving you a solid environment to test your contracts before going live on mainnet.

### Network Info

- **Network Name**: Polkadot Hub TestNet (Paseo Hub)
- **Chain ID**: 420420422
- **Currency**: PAS
- **RPC**: <https://testnet-passet-hub-eth-rpc.polkadot.io>
- **WebSocket**: wss://testnet-passet-hub-eth-rpc.polkadot.io
- **Explorer**: <https://blockscout-passet-hub.parity-testnet.parity.io>

## What You'll Need

Make sure you have these installed:

- [Node.js](https://nodejs.org/) (v16+)
- [Godot Engine 4.5+](https://godotengine.org/)
- [MetaMask](https://metamask.io/) or [Talisman](https://talisman.xyz/) wallet

You'll also want:

- [Hardhat](https://hardhat.org/) for deploying contracts
- Git

## Setting Up Your Wallet

### Using MetaMask

If you don't have MetaMask yet, grab it from their website. Then:

1. Open MetaMask and click the network dropdown
2. Hit "Add Network" → "Add a network manually"
3. Fill in these details:

   ```
   Network Name: Polkadot Hub TestNet
   RPC URL: https://testnet-passet-hub-eth-rpc.polkadot.io
   Chain ID: 420420422
   Currency Symbol: PAS
   Block Explorer: https://blockscout-passet-hub.parity-testnet.parity.io
   ```

4. Save it

### Using Talisman (I'd recommend this one)

1. Install Talisman from [talisman.xyz](https://talisman.xyz)
2. Open Talisman settings → "Networks"
3. Toggle "Testnets" on
4. Paseo should now show up in your network list

## Getting Test Tokens

Head over to the official faucet at <https://faucet.polkadot.io/?parachain=1111>

Set it up like this:

- Network: **Paseo**
- Chain: **Paseo Hub: smart contracts**

Paste your wallet address, complete the CAPTCHA, and click "Get some PASs". You can grab 100 PAS per day.

*There's also [this Medium guide](https://medium.com/@itsbirdo/how-to-get-polkadot-testnet-tokens-on-paseo-8c2fbe45b603) if you need an alternative approach.*

## Deploying Your Contracts

### Getting Set Up

First, clone the Pinkhat contracts repo (this is PolkaGodot's contract suite):

```bash
git clone https://github.com/pinksters/polkagodot-backend.git
cd pinkhat
npm install
# Install OpenZeppelin contracts (required for GameManager.sol)
npm install @openzeppelin/contracts
```

Now configure Hardhat for Paseo. Create or update your `hardhat.config.js`:

```javascript
require('@nomicfoundation/hardhat-toolbox');
require('@parity/hardhat-polkadot');
require('dotenv').config();

module.exports = {
  solidity: '0.8.28',
  resolc: {
    compilerSource: 'npm',
  },
  networks: {
    paseo: {
      polkavm: true,
      url: 'https://testnet-passet-hub-eth-rpc.polkadot.io/',
      accounts: [process.env.PASEO_PRIVATE_KEY],
      chainId: 420420422
    }
  }
};
```

Create a `.env` file with your private key:

```bash
PASEO_PRIVATE_KEY=your_wallet_private_key_here
```

### Deploy Time

You'll need to deploy **3 contracts** for PolkaGodot to work:

1. **hat.sol** - NFT contract for in-game items (deploy first - no constructor args)
2. **RewardsManager.sol** - Handles reward distribution (deploy second - no constructor args)
3. **GameManager.sol** - Manages game state and logic (deploy last - requires HatNFT address)

Compile everything:

```bash
npx hardhat compile
```

Deploy to Paseo:

```bash
npx hardhat run scripts/deploy.js --network paseo
```

The deployment script will automatically:
1. Deploy HatNFT first
2. Deploy RewardsManager
3. Deploy GameManager with the HatNFT address as constructor argument
4. Call `setGameManager` on HatNFT to link the contracts

Check the [block explorer](https://blockscout-passet-hub.parity-testnet.parity.io) to confirm your deployment went through. The script will output all contract addresses - save them for PolkaGodot configuration.

### Alternative: Deploying with Remix

If you prefer a browser-based deployment without setting up Hardhat, you can use [Remix for Polkadot](https://remix.polkadot.io). This is great for quick deployments or if you're new to Solidity development.

You'll need to deploy **3 contracts** for PolkaGodot to work:

1. **gameManager.sol** - Manages game state and logic
2. **hat.sol** - NFT contract for in-game items
3. **RewardsManager.sol** - Handles reward distribution

1. Open [Remix for Polkadot](https://remix.polkadot.io/#lang=en&optimize=false&runs=200&evmVersion=null&version=soljson-v0.8.28+commit.7893614a-revive-0.1.0-dev.12.js) in your browser

2. In the file explorer, create a new file or upload your contract files from the Pinkhat repo. You'll need these files from `contracts/`:
   - `gameManager.sol`
   - `hat.sol`
   - `RewardsManager.sol`

3. Go to the **Solidity Compiler** tab:
   - Select compiler version `0.8.28`
   - Make sure "Enable optimization" matches your contract settings
   - Compile each contract one by one: `gameManager.sol`, `hat.sol`, and `RewardsManager.sol`

4. Navigate to the **Deploy & Run Transactions** tab:
   - Under "Environment", select "Injected Provider - MetaMask" (or your wallet)
   - Make sure your wallet is connected to Paseo Asset Hub (Chain ID: 420420422)
   - Deploy each contract in this order:
     - First deploy `hat.sol` (no constructor arguments needed - note the address)
     - Then deploy `RewardsManager.sol` (no constructor arguments needed - note the address)
     - Finally deploy `gameManager.sol` - **IMPORTANT**: You must provide the HatNFT contract address in the constructor parameter field
   - For gameManager.sol deployment: In the "Deploy" section, paste the HatNFT address (from step 1) in the constructor parameter field before clicking Deploy
   - Click "Deploy" and confirm each transaction in your wallet
   - **Final step**: After all contracts are deployed, call the `setGameManager` function on the HatNFT contract with the GameManager address to link them together

5. Once all three contracts are deployed, copy each contract address from the "Deployed Contracts" section. You'll need these for your PolkaGodot config.

**Note:** Make sure you have enough PAS tokens in your wallet for gas fees. You can get more from the [faucet](https://faucet.polkadot.io/?parachain=1111) if needed.

## Configuring PolkaGodot

### Installing the Plugin

Clone PolkaGodot into your Godot project:

```bash
cd your-godot-project
git clone https://github.com/pinksters/polkagodot-plugin.git addons/polkagodot
```

In Godot, go to `Project` → `Project Settings` → `Plugins` and enable PolkaGodot.

### Setting Up Your Config

Copy the Paseo config template:

```bash
cp addons/polkagodot/config_examples/paseo_config.tres polkagodot_config.tres
```

Open `polkagodot_config.tres` and update it with your deployed contract addresses:

```
[resource]
script = PolkaConfig

chain_id = 420420422
rpc_url = "https://testnet-passet-hub-eth-rpc.polkadot.io"

# Replace these with your actual contract addresses from deployment
# hat.sol address
nft_contract_address = "0x..."
# gameManager.sol address
marketplace_contract_address = "0x..."
# RewardsManager.sol address
registry_contract_address = "0x..."
```

### Web Export Setup

In Godot:

1. Go to `Project` → `Export`
2. Add a "Web" preset if you don't have one
3. Under export settings, set Custom HTML Shell to: `res://addons/polkagodot/polkagodot_export_shell.html`

## Running the Demo

Export your project to a folder (like `build/`), then serve it locally:

```bash
cd build
python -m http.server 8000
```

Open `http://localhost:8000` in your browser. Make sure your wallet is connected to Paseo Asset Hub.

### Testing It Out

1. Click the wallet connect button and approve in MetaMask/Talisman
2. Switch to Paseo Asset Hub if prompted
3. Try browsing NFTs with `PolkaGodot.user_nfts`
4. Equip/unequip some cosmetics and watch the changes
5. Check the block explorer to verify your transactions

## Running Into Issues?

**Not enough funds?**
Hit the faucet again. Check your balance on the block explorer to make sure tokens arrived.

**Network not found?**
Double-check your network config in your wallet. The Chain ID needs to be exactly `420420422`.

**Contract deployment failing?**
Make sure your private key is set correctly in `.env` and you've got enough PAS for gas.

**PolkaGodot won't connect?**
Check your browser console for errors. Verify your custom HTML shell is configured and your contract addresses are correct in the config file.

### Need Help?

- Paseo support: <https://github.com/paseo-network/support>
- Matrix chat: <https://matrix.to/#/#paseo-testnet-support:parity.io>
- PolkaGodot issues: <https://github.com/pinksters/polkagodot-plugin/issues>

## Quick Checklist

Before you start testing, make sure you've:

- [ ] Set up your wallet for Paseo Asset Hub
- [ ] Got test tokens from the faucet
- [ ] Deployed your smart contracts
- [ ] Installed and enabled the PolkaGodot plugin
- [ ] Updated your config with contract addresses
- [ ] Configured web export with the custom HTML shell
- [ ] Got the demo running in your browser
- [ ] Connected your wallet successfully
- [ ] Tested NFT browsing and equipping
- [ ] Verified transactions on-chain

---

Questions? Check out the [PolkaGodot docs](https://github.com/pinksters/polkagodot-plugin) or reach out on the community channels above.
