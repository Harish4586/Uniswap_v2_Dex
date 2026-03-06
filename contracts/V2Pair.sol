// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./libraries/Math.sol";

contract EthTokenAMM is ERC20 {
    using SafeERC20 for IERC20;
    using Math for uint;
    address public immutable feeTo;
    uint public kLast;

    IERC20 public immutable token0;
    IERC20 public immutable token1;

    uint112 private reserve0;
    uint112 private reserve1;
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 private constant MINIMUM_LIQUIDITY = 1000;
    event liquidityAdded(address to,uint liqudity);

    constructor(address _token0, address _token1,address fee_to)
        ERC20("CHICMIC LP TOKEN", "CLP")
    {
        require(_token0 < _token1, "Token order");
        token0 = IERC20(_token0);
        token1 = IERC20(_token1);
        feeTo=fee_to;
    }

    function getReserves() public view returns (uint112, uint112) {
        return (reserve0, reserve1);
    }

    // --------------------------
    // Mint LP (Router sends tokens first)
    // --------------------------
    function mint(address to) external returns (uint liquidity) {
        (uint112 _reserve0, uint112 _reserve1) = getReserves();
         bool feeOn = _mintFee(_reserve0, _reserve1);

        uint balance0 = token0.balanceOf(address(this));
        uint balance1 = token1.balanceOf(address(this));

        uint amount0 = balance0 - _reserve0;
        uint amount1 = balance1 - _reserve1;

        if (totalSupply() == 0) {
            liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(DEAD, MINIMUM_LIQUIDITY);
        } else {
            liquidity = Math.min(
                (amount0 * totalSupply()) / _reserve0,
                (amount1 * totalSupply()) / _reserve1
            );
        }

        require(liquidity > 0, "Insufficient liquidity");
        _mint(to, liquidity);
        emit liquidityAdded(to, liquidity);

        _update(balance0, balance1);
        if (feeOn) kLast = uint(reserve0) * reserve1;
    }

    // --------------------------
    // Burn LP (Router transfers LP first)
    // --------------------------
    function burn(address to)
    external
    returns (uint amount0, uint amount1)
{
    (uint112 _reserve0, uint112 _reserve1) = getReserves();
    bool feeOn = _mintFee(_reserve0, _reserve1);

    uint liquidity = balanceOf(address(this));
    uint _totalSupply = totalSupply();

    amount0 = (liquidity * _reserve0) / _totalSupply;
    amount1 = (liquidity * _reserve1) / _totalSupply;

    require(amount0 > 0 && amount1 > 0, "Insufficient burn");

    _burn(address(this), liquidity);

    token0.safeTransfer(to, amount0);
    token1.safeTransfer(to, amount1);

    _update(
        token0.balanceOf(address(this)),
        token1.balanceOf(address(this))
    );
    if (feeOn) kLast = uint(reserve0) * reserve1;
}
    // --------------------------
    // Swap (tokens already sent in)
    // --------------------------
    function swap(uint amount0Out, uint amount1Out, address to) external {
        require(amount0Out > 0 || amount1Out > 0, "Zero output");

        (uint112 _reserve0, uint112 _reserve1) = getReserves();
        require(amount0Out < _reserve0 && amount1Out < _reserve1, "Liquidity");

        if (amount0Out > 0) token0.safeTransfer(to, amount0Out);
        if (amount1Out > 0) token1.safeTransfer(to, amount1Out);

        uint balance0 = token0.balanceOf(address(this));
        uint balance1 = token1.balanceOf(address(this));

        uint amount0In = balance0 > (_reserve0 - amount0Out)
            ? balance0 - (_reserve0 - amount0Out)
            : 0;
        uint amount1In = balance1 > (_reserve1 - amount1Out)
            ? balance1 - (_reserve1 - amount1Out)
            : 0;

        require(amount0In > 0 || amount1In > 0, "No input");

        // 0.3% fee enforcement (constant product invariant)
        uint balance0Adjusted = (balance0 * 1000) - (amount0In * 3);
        uint balance1Adjusted = (balance1 * 1000) - (amount1In * 3);

        require(
            balance0Adjusted * balance1Adjusted >=
                uint(_reserve0) * uint(_reserve1) * 1000**2,
            "K invariant"
        );

        _update(balance0, balance1);
    }
    function _mintFee(uint112 _reserve0, uint112 _reserve1) private returns (bool feeOn) {
    feeOn = feeTo != address(0);
    uint _kLast = kLast;

    if (feeOn) {
        if (_kLast != 0) {
            uint rootK     = Math.sqrt(uint(_reserve0) * uint(_reserve1));
            uint rootKLast = Math.sqrt(_kLast);

            if (rootK > rootKLast) {
                uint numerator   = totalSupply() * (rootK - rootKLast);
                uint denominator = (rootK * 5) + rootKLast;
                uint liquidity   = numerator / denominator;

                if (liquidity > 0) _mint(feeTo, liquidity);
            }
        }
    } else if (_kLast != 0) {
        kLast = 0;
    }
}



    function _update(uint balance0, uint balance1) private {
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
    }
}