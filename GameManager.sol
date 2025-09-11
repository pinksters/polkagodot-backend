// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IHatNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getHatType(uint256 tokenId) external view returns (string memory);
}

contract GameManager is Ownable {
    IHatNFT public hatNFT;
    
    uint256 public constant DEFAULT_HAT_ID = 0; // Represents no hat equipped (default)
    uint256 public currentGameId = 1;
    
    struct PlayerStats {
        uint256[] gamesPlayed;
        uint256 totalGamesPlayed;
        uint256 bestScore;
        uint256 bestScoreGameId;
        uint256 totalWins;
        uint256 equippedHat;
        bool hasPlayed;
    }
    
    struct GameResult {
        address[7] players;
        uint256[7] times;
        uint256[7] equippedHats;
        uint256 playerCount;
        uint256 timestamp;
        address winner;
    }
    
    mapping(address => PlayerStats) public playerStats;
    mapping(uint256 => GameResult) public games;
    
    event HatEquipped(address indexed player, uint256 indexed tokenId);
    event GameSubmitted(uint256 indexed gameId, address indexed winner, uint256 playerCount);
    event NewPersonalBest(address indexed player, uint256 newBestScore, uint256 gameId);
    
    constructor(address _hatNFTAddress) Ownable(msg.sender) {
        hatNFT = IHatNFT(_hatNFTAddress);
    }
    
    function equipHat(uint256 tokenId) external {
        if (tokenId != DEFAULT_HAT_ID) {
            require(hatNFT.ownerOf(tokenId) == msg.sender, "You don't own this hat");
        }
        
        playerStats[msg.sender].equippedHat = tokenId;
        emit HatEquipped(msg.sender, tokenId);
    }
    
    function getEquippedHat(address player) external view returns (uint256) {
        return playerStats[player].equippedHat;
    }
    
    function submitGameResult(
        address[] calldata players,
        uint256[] calldata times
    ) external onlyOwner {
        require(players.length == times.length, "Arrays length mismatch");
        require(players.length > 0 && players.length <= 7, "Invalid player count");
        
        address winner = players[0];
        uint256 winnerTime = times[0];
        
        for (uint256 i = 1; i < times.length; i++) {
            if (times[i] < winnerTime) {
                winner = players[i];
                winnerTime = times[i];
            }
        }
        
        GameResult storage game = games[currentGameId];
        game.playerCount = players.length;
        game.timestamp = block.timestamp;
        game.winner = winner;
        
        for (uint256 i = 0; i < players.length; i++) {
            address player = players[i];
            uint256 time = times[i];
            
            game.players[i] = player;
            game.times[i] = time;
            game.equippedHats[i] = playerStats[player].equippedHat;
            
            PlayerStats storage stats = playerStats[player];
            
            if (!stats.hasPlayed) {
                stats.hasPlayed = true;
                stats.bestScore = time;
                stats.bestScoreGameId = currentGameId;
            } else if (time < stats.bestScore) {
                stats.bestScore = time;
                stats.bestScoreGameId = currentGameId;
                emit NewPersonalBest(player, time, currentGameId);
            }
            
            stats.gamesPlayed.push(currentGameId);
            stats.totalGamesPlayed++;
            
            if (player == winner) {
                stats.totalWins++;
            }
        }
        
        emit GameSubmitted(currentGameId, winner, players.length);
        currentGameId++;
    }
    
    function getPlayerStats(address player) external view returns (
        uint256[] memory gamesPlayed,
        uint256 totalGamesPlayed,
        uint256 bestScore,
        uint256 bestScoreGameId,
        uint256 totalWins,
        uint256 equippedHat,
        bool hasPlayed
    ) {
        PlayerStats memory stats = playerStats[player];
        return (
            stats.gamesPlayed,
            stats.totalGamesPlayed,
            stats.bestScore,
            stats.bestScoreGameId,
            stats.totalWins,
            stats.equippedHat,
            stats.hasPlayed
        );
    }
    
    function getGameResult(uint256 gameId) external view returns (
        address[7] memory players,
        uint256[7] memory times,
        uint256[7] memory equippedHats,
        uint256 playerCount,
        uint256 timestamp,
        address winner
    ) {
        GameResult memory game = games[gameId];
        return (
            game.players,
            game.times,
            game.equippedHats,
            game.playerCount,
            game.timestamp,
            game.winner
        );
    }
    
    function getPlayerGameHistory(address player, uint256 offset, uint256 limit) 
        external view returns (uint256[] memory gameIds) 
    {
        uint256[] memory allGames = playerStats[player].gamesPlayed;
        
        if (offset >= allGames.length) {
            return new uint256[](0);
        }
        
        uint256 end = offset + limit;
        if (end > allGames.length) {
            end = allGames.length;
        }
        
        uint256 resultLength = end - offset;
        gameIds = new uint256[](resultLength);
        
        for (uint256 i = 0; i < resultLength; i++) {
            gameIds[i] = allGames[offset + i];
        }
        
        return gameIds;
    }
    
    function getTotalGames() external view returns (uint256) {
        return currentGameId - 1;
    }
    
    function getLeaderboardData(address[] calldata players) 
        external view returns (
            address[] memory,
            uint256[] memory bestScores,
            uint256[] memory totalWins,
            uint256[] memory totalGames
        ) 
    {
        uint256 length = players.length;
        bestScores = new uint256[](length);
        totalWins = new uint256[](length);
        totalGames = new uint256[](length);
        
        for (uint256 i = 0; i < length; i++) {
            PlayerStats memory stats = playerStats[players[i]];
            bestScores[i] = stats.hasPlayed ? stats.bestScore : type(uint256).max;
            totalWins[i] = stats.totalWins;
            totalGames[i] = stats.totalGamesPlayed;
        }
        
        return (players, bestScores, totalWins, totalGames);
    }
}