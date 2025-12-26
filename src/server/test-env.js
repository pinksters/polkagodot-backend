require('dotenv').config({ path: '../../config/.env' });

console.log('Environment variables loaded:');
console.log('PRIVATE_KEY:', process.env.PRIVATE_KEY ? 'SET (length: ' + process.env.PRIVATE_KEY.length + ')' : 'NOT SET');
console.log('HAT_NFT_ADDRESS:', process.env.HAT_NFT_ADDRESS);
console.log('GAME_MANAGER_ADDRESS:', process.env.GAME_MANAGER_ADDRESS);
console.log('REWARDS_MANAGER_ADDRESS:', process.env.REWARDS_MANAGER_ADDRESS);
console.log('RPC_URL:', process.env.RPC_URL);

// Check for hidden characters
if (process.env.PRIVATE_KEY) {
    console.log('Private key first 10 chars:', process.env.PRIVATE_KEY.substring(0, 10));
    console.log('Private key last 10 chars:', process.env.PRIVATE_KEY.substring(process.env.PRIVATE_KEY.length - 10));
}