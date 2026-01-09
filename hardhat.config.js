require('@parity/hardhat-polkadot');
require('@nomiclabs/hardhat-ethers');
require('dotenv').config();

module.exports = {
  solidity: '0.8.28',
  resolc: {
    compilerSource: 'npm',
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337
    },
    paseo: {
      polkadot: true,
      url: 'https://testnet-passet-hub-eth-rpc.polkadot.io/',
      accounts: process.env.PASEO_PRIVATE_KEY ? [process.env.PASEO_PRIVATE_KEY] : [],
      chainId: 420420422
    }
  }
};