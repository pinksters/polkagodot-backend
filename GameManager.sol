// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// LFP

import "@openzeppelin/contracts/access/Ownable.sol";

interface IHatNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getHatType(uint256 tokenId) external view returns (string memory);
}

contract GameManager is Ownable {
    IHatNFT public hatNFT;

    uint256 public constant DEFAULT_HAT_ID = 0; // Represents no hat equipped (default)
    uint256 public currentGameId = 1;
    bool public isDescendingOrder = true; // true = higher scores better, false = lower scores better

    struct PlayerStats {
        uint256 bestScore;
        uint256 totalWins;
        uint256 equippedHat;
        bool hasPlayed;
    }

    mapping(address => PlayerStats) public playerStats;

    event GameSubmitted(uint256 indexed gameId, address indexed winner, uint256 playerCount, address[] players, uint256[] scores);
    event ScoreOrderingChanged(bool isDescendingOrder);

    constructor(address _hatNFTAddress) Ownable(msg.sender) {
        hatNFT = IHatNFT(_hatNFTAddress);
    }

    function equipHat(uint256 tokenId) external {
        if (tokenId != DEFAULT_HAT_ID) {
            require(hatNFT.ownerOf(tokenId) == msg.sender, "You don't own this hat");
        }
        playerStats[msg.sender].equippedHat = tokenId;
    }

    function getEquippedHat(address player) external view returns (uint256) {
        return playerStats[player].equippedHat;
    }

    function toggleScoreOrdering() external onlyOwner {
        isDescendingOrder = !isDescendingOrder;
        emit ScoreOrderingChanged(isDescendingOrder);
    }

    function submitGameResult(
        address[] calldata players,
        uint256[] calldata scores
    ) external onlyOwner {
        require(players.length == scores.length, "Arrays length mismatch");
        require(players.length > 0 && players.length <= 7, "Invalid player count");

        address winner = players[0];
        uint256 winnerScore = scores[0];

        for (uint256 i = 1; i < scores.length; i++) {
            bool isBetter = isDescendingOrder ? scores[i] > winnerScore : scores[i] < winnerScore;
            if (isBetter) {
                winner = players[i];
                winnerScore = scores[i];
            }
        }

        for (uint256 i = 0; i < players.length; i++) {
            address player = players[i];
            uint256 score = scores[i];
            PlayerStats storage stats = playerStats[player];

            if (!stats.hasPlayed) {
                stats.hasPlayed = true;
                stats.bestScore = score;
            } else {
                bool isNewBest = isDescendingOrder ? score > stats.bestScore : score < stats.bestScore;
                if (isNewBest) {
                    stats.bestScore = score;
                }
            }

            if (player == winner) {
                stats.totalWins++;
            }
        }

        emit GameSubmitted(currentGameId, winner, players.length, players, scores);
        currentGameId++;
    }


    function getTotalGames() external view returns (uint256) {
        return currentGameId - 1;
    }

}