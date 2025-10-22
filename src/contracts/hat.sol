// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IGameManager {
    function getEquippedHat(address player) external view returns (uint256);
    function unequipHatForPlayer(address player, uint256 tokenId) external;
}

contract HatNFT {
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    
    mapping(uint256 => address) public ownerOf;
    
    address private _owner;
    uint256 private _nextTokenId = 1;
    IGameManager public gameManager;

    constructor() {
        _owner = msg.sender;
    }

    function mint(address to) external {
        require(msg.sender == _owner && to != address(0));
        
        uint256 tokenId = _nextTokenId++;
        ownerOf[tokenId] = to;
        
        emit Transfer(address(0), to, tokenId);
    }

    function transfer(address to, uint256 tokenId) external {
        require(ownerOf[tokenId] == msg.sender && to != address(0));
        
        address from = msg.sender;
        
        // Auto-unequip if GameManager is set
        if (address(gameManager) != address(0)) {
            try gameManager.getEquippedHat(from) returns (uint256 equippedHat) {
                if (equippedHat == tokenId) {
                    gameManager.unequipHatForPlayer(from, tokenId);
                }
            } catch {}
        }
        
        ownerOf[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function setGameManager(address _gameManager) external {
        require(msg.sender == _owner);
        gameManager = IGameManager(_gameManager);
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(ownerOf[tokenId] != address(0));
        
        if (tokenId == 0) return "";
        
        // Convert tokenId to string manually to save space
        uint256 temp = tokenId;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        
        bytes memory buffer = new bytes(digits);
        temp = tokenId;
        while (temp != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(temp % 10)));
            temp /= 10;
        }
        
        return string(abi.encodePacked("https://pinkhats.4everland.store/", string(buffer), ".json"));
    }
}