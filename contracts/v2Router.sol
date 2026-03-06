// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./Interfaces/Ifactory.sol";
import "./Interfaces/Ipair.sol";
import "./Interfaces/Iweth.sol";



contract Router {
    using SafeERC20 for IERC20;
    address public immutable WETH;
    address public immutable factory;
    receive() external payable {}

    constructor(address _factory, address _weth) {
        factory = _factory;
        WETH = _weth;
    }

 



    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountA,
        uint amountB
    ) external {
        address pair = Ifactory(factory).getPair(tokenA, tokenB);
     if (pair == address(0)) {
            pair = Ifactory(factory).createPair(tokenA, tokenB);
        }

        IERC20(tokenA).safeTransferFrom(msg.sender, pair, amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, pair, amountB);

        IPair(pair).mint(msg.sender);
    }

  

    function addLiquidityETH(
        address token,
        uint amountToken
    ) external payable {

        address pair = Ifactory(factory).getPair(token, WETH);

        if (pair == address(0)) {
            pair = Ifactory(factory).createPair(token, WETH);
        }

        IERC20(token).safeTransferFrom(msg.sender, pair, amountToken);

        IWETH(WETH).deposit{value: msg.value}();
        IERC20(WETH).transfer(pair, msg.value);

        IPair(pair).mint(msg.sender);
    }


function removeLiquidity(
    address tokenA,
    address tokenB,
    uint liquidity
) external {
    address pair = Ifactory(factory).getPair(tokenA, tokenB);
    require(pair != address(0), "Pair not exist");

    IERC20(pair).safeTransferFrom(msg.sender, pair, liquidity);

    IPair(pair).burn(msg.sender);
}
function removeLiquidityETH(
    address token,
    uint liquidity
) external {
    address pair = Ifactory(factory).getPair(token, WETH);
    require(pair != address(0), "Pair not exist");

    IERC20(pair).safeTransferFrom(msg.sender, pair, liquidity);

    (uint amount0, uint amount1) = IPair(pair).burn(address(this));

    (uint amountToken, uint amountWETH) = token == IPair(pair).token0()
        ? (amount0, amount1)
        : (amount1, amount0);

    IERC20(token).safeTransfer(msg.sender, amountToken);

    IWETH(WETH).withdraw(amountWETH);
    (bool success, ) = payable(msg.sender).call{value: amountWETH}("");
    require(success, "ETH transfer failed");
}



    function swapExactTokensForTokens(
        address tokenIn,
        address tokenOut,
        uint amountIn,
        uint minOut
    ) external {
        address pair = Ifactory(factory).getPair(tokenIn, tokenOut);
        require(pair != address(0), "Pair not exist");
        (uint112 r0, uint112 r1) = IPair(pair).getReserves();

        (uint reserveIn, uint reserveOut) =
            tokenIn == IPair(pair).token0()
                ? (r0, r1)
                : (r1, r0);

        uint amountInWithFee = amountIn * 997;
        uint amountOut =
            (amountInWithFee * reserveOut) /
            (reserveIn * 1000 + amountInWithFee);

        require(amountOut >= minOut, "Slippage");

        IERC20(tokenIn).safeTransferFrom(msg.sender, pair, amountIn);

        if (tokenIn == IPair(pair).token0()) {
            IPair(pair).swap(0, amountOut, msg.sender);
        } else {
            IPair(pair).swap(amountOut, 0, msg.sender);
        }
    }

    //important swap eth<->token



    function swapExactETHForTokens(
        address tokenOut,
        uint minOut
    ) external payable {

        address pair = Ifactory(factory).getPair(WETH, tokenOut);
        require(pair != address(0), "Pair not exist");

        IWETH(WETH).deposit{value: msg.value}();
        IERC20(WETH).transfer(pair, msg.value);

        _swap(pair, WETH, msg.value, minOut, msg.sender);
    }

    function swapExactTokensForETH(
        address tokenIn,
        uint amountIn,
        uint minOut
    ) external {

        address pair = Ifactory(factory).getPair(tokenIn, WETH);
        require(pair != address(0), "Pair not exist");

        IERC20(tokenIn).safeTransferFrom(msg.sender, pair, amountIn);

        uint amountOut = _swap(pair, tokenIn, amountIn, minOut, address(this));

        IWETH(WETH).withdraw(amountOut);
        payable(msg.sender).transfer(amountOut);
    }


function _swap(
        address pair,
        address tokenIn,
        uint amountIn,
        uint minOut,
        address to
    ) internal returns (uint amountOut) {

        (uint112 r0, uint112 r1) = IPair(pair).getReserves();

        (uint reserveIn, uint reserveOut) =
            tokenIn == IPair(pair).token0()
                ? (r0, r1)
                : (r1, r0);

        uint amountInWithFee = amountIn * 997;
        amountOut =
            (amountInWithFee * reserveOut) /
            (reserveIn * 1000 + amountInWithFee);

        require(amountOut >= minOut, "Slippage");

        if (tokenIn == IPair(pair).token0()) {
            IPair(pair).swap(0, amountOut, to);
        } else {
            IPair(pair).swap(amountOut, 0, to);
        }
    }
}


//addresses
/**
Deploying with: 0x878344AF84A404439Ea37cFB9b30DeFd7938741C
WETH     : 0x129BCd9e66ABdb06B331B41c3A662f5f247ffcC4
Factory  : 0x70a8782a069482444aB05294B8403F60AD84c16C
Router   : 0xe1a5F2171B7F64BB5d799D316633d37FecAeECcA
 */