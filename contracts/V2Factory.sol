// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import './Interfaces/Ifactory.sol';
import "./V2Pair.sol";

contract Factory is Ifactory {
address public feeTo;
address public feeToSetter;
mapping (address=>mapping(address=>address) ) public getPair;
address[] public allPairs;
// bytes32 public constant INIT_CODE_HASH =
//     keccak256(type(EthTokenAMM).creationCode); //for future use

error IdenticalAddresses();
error ZeroAddress();
error PairExists();
error NotContract();

constructor (address _feeToSetter){
    feeToSetter=_feeToSetter;
}
function allPairsLength() external  view returns(uint){
    return allPairs.length;
}

function createPair(address tokenA,address tokenB) external returns(address pair){
    // require(tokenA!=tokenB,"tokens are identical");
    if (tokenA == tokenB) revert IdenticalAddresses();
    (address token0,address token1)= tokenA<tokenB?(tokenA,tokenB):(tokenB,tokenA);
    // require(token0 !=address(0),"can't make pair with Zero Address"); //surely token0 will have less value so if zero address is passed ,it must be token0
   if (token0 ==address(0)) revert ZeroAddress();
    // require(token0.code.length > 0, "NOT_CONTRACT"); //these 2 checks are for checing if the provided contracts are erc20 or not
    // require(token1.code.length > 0, "NOT_CONTRACT");
    if (token0.code.length == 0 || token1.code.length == 0){
    revert NotContract();}
    // require(getPair[token0][token1]==address(0),"pair already exists"); //if pair already exists then getPair[token0][token] will contain the address of the pair)
    if (getPair[token0][token1]!=address(0)) revert PairExists();
    // bytes32 salt= keccak256(abi.encodePacked(token0,token1)); //encodePacked is used because  we want to concatenate the addresses wtihout padding or info
    pair= address(new EthTokenAMM(token0,token1,feeTo));
    getPair[token0][token1] = pair;
    getPair[token1][token0] = pair;

    allPairs.push(pair);

    emit pairCreation(token0, token1, pair, allPairs.length);
}

function setFeeTo(address _feeTo) external {
    require(msg.sender==feeToSetter,"setFeeTo Action ForBidden");
    feeTo=_feeTo;
}
function setFeeToSetter(address _feeToSetter) external {
    require(msg.sender==feeToSetter,"setFeeToSetter Action ForBidden");
    feeToSetter=_feeToSetter;
}


}