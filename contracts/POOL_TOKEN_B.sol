// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract POOL_TOKEN_B is ERC20 {
    event tokenGenerated(address to,uint256 supply);
    constructor(uint256 initialSupply) ERC20("TokenB", "TKB") {
        _mint(msg.sender, initialSupply * 10 ** decimals());
        emit tokenGenerated(msg.sender, balanceOf(msg.sender));
    }
    function mintToParticularUser(uint256 initialSupply) public {
         _mint(msg.sender, initialSupply * 10 ** decimals());
         emit tokenGenerated(msg.sender, balanceOf(msg.sender));
    }
}