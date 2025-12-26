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