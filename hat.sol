// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract HatNFT is ERC721, ERC721Enumerable, Ownable {
    using Strings for uint256;

    uint256 private _nextTokenId = 1;

    // Base URI for metadata
    string private _baseTokenURI;

    // Mapping from token ID to hat type
    mapping(uint256 => string) public hatTypes;

    // Available hat types
    string[4] public availableHats = [
        "Hawaiian hat",
        "Cowboy hat",
        "Bucket hat",
        "Traffic cone"
    ];

    // Track which hats have been minted
    mapping(string => bool) public hatMinted;

    constructor(
        string memory name,
        string memory symbol,
        string memory baseTokenURI
    ) ERC721(name, symbol) Ownable(msg.sender) {
        _baseTokenURI = baseTokenURI;
    }

    /**
     * @dev Mint a specific hat type to an address
     * @param to Address to mint the NFT to
     * @param hatType The type of hat to mint (must match availableHats)
     */
    function mintHat(address to, string memory hatType) public onlyOwner {
        require(!hatMinted[hatType], "This hat type has already been minted");
        require(_isValidHatType(hatType), "Invalid hat type");

        uint256 tokenId = _nextTokenId++;
        hatTypes[tokenId] = hatType;
        hatMinted[hatType] = true;

        _safeMint(to, tokenId);
    }

    /**
     * @dev Mint all available hats to an address
     * @param to Address to mint all NFTs to
     */
    function mintAllHats(address to) public onlyOwner {
        require(_nextTokenId == 1, "Some hats have already been minted");

        for (uint i = 0; i < availableHats.length; i++) {
            uint256 tokenId = _nextTokenId++;
            string memory hatType = availableHats[i];
            hatTypes[tokenId] = hatType;
            hatMinted[hatType] = true;
            _safeMint(to, tokenId);
        }
    }

    /**
     * @dev Returns the token URI for a given token ID
     */
    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "URI query for nonexistent token");

        return bytes(_baseTokenURI).length > 0
            ? string(abi.encodePacked(_baseTokenURI, tokenId.toString(), ".json"))
            : "";
    }

    /**
     * @dev Set the base URI for token metadata
     */
    function setBaseURI(string memory baseTokenURI) public onlyOwner {
        _baseTokenURI = baseTokenURI;
    }

    /**
     * @dev Get the hat type for a specific token ID
     */
    function getHatType(uint256 tokenId) public view returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Query for nonexistent token");
        return hatTypes[tokenId];
    }

    /**
     * @dev Check if a hat type is valid
     */
    function _isValidHatType(string memory hatType) private view returns (bool) {
        for (uint i = 0; i < availableHats.length; i++) {
            if (keccak256(abi.encodePacked(availableHats[i])) == keccak256(abi.encodePacked(hatType))) {
                return true;
            }
        }
        return false;
    }

    /**
     * @dev Get total number of tokens minted
     */
    function totalSupply() public view override returns (uint256) {
        return _nextTokenId - 1;
    }

    /**
     * @dev Override required by Solidity for multiple inheritance
     */
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    /**
     * @dev Override required by Solidity for multiple inheritance
     */
    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721, ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    /**
     * @dev Override required by Solidity for multiple inheritance
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}