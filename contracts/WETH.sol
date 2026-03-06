// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MyWETH is ERC20("Wrapped ETH", "WETH") {

    constructor() {}

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        _mint(msg.sender, msg.value);
    }
    function withdraw(uint amount) public {
        _burn(msg.sender, amount);
         (bool success,)=payable(msg.sender).call{value:amount}("");
         require(success,"eth transfer failed!");
    }
}
