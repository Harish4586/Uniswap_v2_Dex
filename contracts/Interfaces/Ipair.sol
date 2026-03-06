// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
interface IPair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112, uint112);
    function mint(address to) external returns (uint);
    function burn(address to) external returns (uint, uint);
    function swap(uint amount0Out, uint amount1Out, address to) external;
}