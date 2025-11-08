// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract RewardsManager {
    address owner;
    uint256 public totalRewardAmount;
    uint8 public numberOfWinners;
    bool public isActive;
    uint256 public percent1 = 50;
    uint256 public percent2 = 30;
    uint256 public percent3 = 20;

    mapping(uint256 => bool) public gameResultsStored;
    mapping(uint256 => address) public winner1;
    mapping(uint256 => address) public winner2;
    mapping(uint256 => address) public winner3;
    mapping(uint256 => mapping(address => bool)) public rewardsClaimed;

    constructor() { owner = msg.sender; }

    function configureGlobalRewards(uint256 _total, uint8 _winners, uint256[] calldata _percentages) external {
        require(msg.sender == owner);
        require(_winners <= 3);
        require(_total > 0);
        require(_percentages.length == _winners);

        uint256 sum;
        for (uint i; i < _percentages.length; ++i) sum += _percentages[i];
        require(sum == 100);

        totalRewardAmount = _total;
        numberOfWinners = _winners;
        if (_winners >= 1) percent1 = _percentages[0];
        if (_winners >= 2) percent2 = _percentages[1];
        if (_winners >= 3) percent3 = _percentages[2];
        isActive = true;
    }

    function submitGameResults(uint256 gameId, address[] calldata winners) external {
        require(msg.sender == owner);
        require(!gameResultsStored[gameId]);
        require(isActive);
        require(winners.length == numberOfWinners);

        if (numberOfWinners >= 1) winner1[gameId] = winners[0];
        if (numberOfWinners >= 2) winner2[gameId] = winners[1];
        if (numberOfWinners >= 3) winner3[gameId] = winners[2];
        gameResultsStored[gameId] = true;
    }

    function batchDistributeRewards(uint256 gameId) external {
        require(msg.sender == owner && gameResultsStored[gameId] && isActive);

        if (numberOfWinners >= 1) {
            address p = winner1[gameId];
            if (!rewardsClaimed[gameId][p] && address(this).balance >= totalRewardAmount * percent1 / 100) {
                rewardsClaimed[gameId][p] = true;
                payable(p).transfer(totalRewardAmount * percent1 / 100);
            }
        }

        if (numberOfWinners >= 2) {
            address p = winner2[gameId];
            if (!rewardsClaimed[gameId][p] && address(this).balance >= totalRewardAmount * percent2 / 100) {
                rewardsClaimed[gameId][p] = true;
                payable(p).transfer(totalRewardAmount * percent2 / 100);
            }
        }

        if (numberOfWinners >= 3) {
            address p = winner3[gameId];
            if (!rewardsClaimed[gameId][p] && address(this).balance >= totalRewardAmount * percent3 / 100) {
                rewardsClaimed[gameId][p] = true;
                payable(p).transfer(totalRewardAmount * percent3 / 100);
            }
        }
    }

    // Direct reward distribution for leaderboard rewards (no storage, flexible winners)
    function distributeLeaderboardRewards(address[] calldata winners, uint256[] calldata amounts) external {
        require(msg.sender == owner);
        require(winners.length == amounts.length);
        require(winners.length <= 10); // Reasonable gas limit

        for (uint i = 0; i < winners.length; i++) {
            if (address(this).balance >= amounts[i] && amounts[i] > 0) {
                payable(winners[i]).transfer(amounts[i]);
            }
        }
    }

    receive() external payable {}
}