
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
interface Ifactory {
    event pairCreation(address indexed token0,address indexed token1,address pair,uint);
    function feeTo()external  view returns(address);
    function feeToSetter() external view returns(address);
    function getPair(address A,address B) external view returns(address);
    function allPairs(uint) external view returns(address pair);
    function allPairsLength() external view returns (uint);
    function createPair(address A,address B) external returns (address pair);
    function setFeeTo(address) external; //protocol fee goes to this address 
    function setFeeToSetter(address) external; //only feeToSetter can call setFeeTo function)
}