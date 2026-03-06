# EthTokenAMM — Decentralized Exchange (DEX)

A Uniswap V2-style Automated Market Maker (AMM) built in Solidity. Supports ERC-20 token swaps, ETH/token swaps via WETH, liquidity provisioning, and a configurable protocol fee.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Contracts](#contracts)
- [How It Works](#how-it-works)
- [Protocol Fee](#protocol-fee)
- [Deployment](#deployment)
- [Testing](#testing)
- [Deployed Addresses](#deployed-addresses)

---

## Overview

This project implements a minimal but complete DEX with the following features:

- **Token ↔ Token swaps** with a 0.3% fee
- **ETH ↔ Token swaps** via a Wrapped ETH (WETH) contract
- **Liquidity provisioning** — mint/burn LP tokens proportional to pool share
- **Protocol fee** — optional 1/6th fee on swap growth, minted as LP tokens to a `feeTo` address
- **Factory pattern** — deploy new trading pairs on demand

---

## Architecture

```
User
 │
 ▼
Router  ──────────────────────────────────────────────────┐
 │  addLiquidity / removeLiquidity                         │
 │  swapExactTokensForTokens                               │
 │  swapExactETHForTokens / swapExactTokensForETH          │
 ▼                                                         │
Factory ──── createPair() ──► EthTokenAMM (Pair)          │
 │                             │  mint() / burn()          │
 │  getPair(tokenA, tokenB)    │  swap()                   │
 │  setFeeTo / setFeeToSetter  │  kLast / _mintFee         │
 ▼                             ▼                           │
Pair Registry            LP Token (ERC-20)                 │
                               │                           │
                         WETH Contract ◄───────────────────┘
                         deposit() / withdraw()
```

---

## Contracts

### `Factory.sol`
Deploys and tracks all trading pairs.

| Function | Description |
|---|---|
| `createPair(tokenA, tokenB)` | Deploys a new `EthTokenAMM` pair. Tokens are sorted so `token0 < token1`. |
| `getPair(tokenA, tokenB)` | Returns the pair address (order-independent). |
| `allPairs(index)` | Returns pair address at a given index. |
| `allPairsLength()` | Total number of pairs created. |
| `setFeeTo(address)` | Sets the protocol fee recipient (only `feeToSetter`). |
| `setFeeToSetter(address)` | Transfers admin role to a new address. |

> **Note:** `feeTo` is passed into the pair at deployment time and stored locally. Changing `factory.feeTo` after pair creation does **not** affect existing pairs.

---

### `EthTokenAMM.sol` (Pair)
The core AMM contract. Also an ERC-20 representing LP shares (`CHICMIC LP TOKEN / CLP`).

| Function | Description |
|---|---|
| `mint(address to)` | Called after tokens are transferred in. Mints LP tokens to `to`. |
| `burn(address to)` | Called after LP tokens are transferred in. Burns them and returns underlying tokens. |
| `swap(amount0Out, amount1Out, address to)` | Sends tokens out after verifying the constant-product invariant (K). |
| `getReserves()` | Returns current `reserve0` and `reserve1`. |

**Key invariants:**
- Constant product: `x * y = k`, enforced after every swap.
- 0.3% swap fee stays in the pool, growing K over time.
- `MINIMUM_LIQUIDITY` (1000 wei of LP) is permanently locked to the dead address on the first mint to prevent price manipulation attacks.

---

### `Router.sol`
The user-facing entry point. Handles token approvals, WETH wrapping/unwrapping, and routes calls to the correct pair.

| Function | Description |
|---|---|
| `addLiquidity(tokenA, tokenB, amountA, amountB)` | Adds ERC-20 liquidity. Creates pair if it doesn't exist. |
| `addLiquidityETH(token, amountToken)` | Adds ETH + token liquidity. Wraps ETH to WETH. |
| `removeLiquidity(tokenA, tokenB, liquidity)` | Burns LP tokens and returns underlying ERC-20s. |
| `removeLiquidityETH(token, liquidity)` | Burns LP tokens, returns token + unwrapped ETH. |
| `swapExactTokensForTokens(tokenIn, tokenOut, amountIn, minOut)` | Swaps ERC-20 for ERC-20 with slippage protection. |
| `swapExactETHForTokens(tokenOut, minOut)` | Wraps sent ETH and swaps for token. |
| `swapExactTokensForETH(tokenIn, amountIn, minOut)` | Swaps token for WETH, then unwraps to ETH. |

---

### `MyWETH.sol`
A minimal Wrapped ETH implementation.

| Function | Description |
|---|---|
| `deposit()` | Accepts ETH, mints equivalent WETH. Also triggered by sending ETH directly. |
| `withdraw(amount)` | Burns WETH, sends back ETH. |

---

## How It Works

### Adding Liquidity

1. User calls `router.addLiquidity(tokenA, tokenB, amountA, amountB)`.
2. Router transfers tokens directly to the pair contract.
3. Pair's `mint()` is called — calculates LP tokens based on deposited amounts vs. existing reserves.
4. On the **first deposit**, `sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY` LP tokens are minted. `MINIMUM_LIQUIDITY` is sent to the dead address forever.
5. On **subsequent deposits**, LP tokens are minted proportionally: `min((amount0 / reserve0), (amount1 / reserve1)) * totalSupply`.

### Swapping

1. User calls `router.swapExactTokensForTokens(tokenIn, tokenOut, amountIn, minOut)`.
2. Router calculates `amountOut` using the AMM formula with the 0.3% fee:
   ```
   amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
   ```
3. Reverts if `amountOut < minOut` (slippage guard).
4. Tokens are transferred to the pair, then `pair.swap()` is called.
5. Pair verifies the constant-product invariant holds after the swap.

### Removing Liquidity

1. User approves the router to transfer their LP tokens.
2. Router transfers LP tokens to the pair.
3. Pair's `burn()` calculates proportional share:
   ```
   amount0 = (liquidity / totalSupply) * reserve0
   amount1 = (liquidity / totalSupply) * reserve1
   ```
4. LP tokens are burned and underlying tokens are returned to the user.

---

## Protocol Fee

The protocol supports an optional **1/6th fee** on liquidity growth (equivalent to ~0.05% of swap volume):

- When `feeTo != address(0)`, the pair tracks `kLast = reserve0 * reserve1` after each mint/burn.
- On the next mint or burn, `_mintFee()` compares the current `sqrt(k)` to `sqrt(kLast)`.
- If the pool has grown (due to swap fees), additional LP tokens are minted to `feeTo`:
  ```
  liquidity = totalSupply * (sqrt(k) - sqrt(kLast)) / (5 * sqrt(k) + sqrt(kLast))
  ```
- When `feeTo` is the zero address, `kLast` is reset to 0 and no fee is collected.

> **Important:** `feeTo` is set at pair creation time and stored inside the pair. Updating `factory.feeTo` only affects newly created pairs — it has no effect on existing ones. To make the fee address dynamic, upgrade the pair to query `IFactory(factory).feeTo()` inside `_mintFee`.

---

## Deployment

### Prerequisites

```bash
npm install
```

### Deploy Script

```bash
npx hardhat run scripts/deploy.ts --network <network>
```

The deploy script:
1. Deploys `MyWETH`
2. Deploys `Factory` with the deployer as `feeToSetter`
3. Deploys `Router` with Factory and WETH addresses

---

## Testing

Run the full test suite with:

```bash
npx hardhat test
```

The test suite covers:

- **Factory** — pair creation, duplicate prevention, zero-address guards, `allPairs` tracking
- **Fee Governance** — `setFeeTo`, `setFeeToSetter`, access control
- **Mint** — first and subsequent deposits, reserve accuracy, LP token amounts, ETH pairs
- **Burn** — full and partial removal, ETH withdrawal, proportional returns
- **Swap (Token ↔ Token)** — fee enforcement, slippage guard, K invariant, price impact
- **Swap (ETH ↔ Token)** — ETH wrapping/unwrapping, reserve updates, error cases
- **Protocol Fee** — `kLast` tracking, fee LP minting, redemption, fee-off behavior, multi-user scenarios

---

## Deployed Addresses

| Contract | Address |
|---|---|
| Deployer | `0x878344AF84A404439Ea37cFB9b30DeFd7938741C` |
| WETH | `0x129BCd9e66ABdb06B331B41c3A662f5f247ffcC4` |
| Factory | `0x70a8782a069482444aB05294B8403F60AD84c16C` |
| Router | `0xe1a5F2171B7F64BB5d799D316633d37FecAeECcA` |

---

## Known Limitations & Audit Notes

- **Static `feeTo`:** The pair stores `feeTo` at deploy time. Changing the factory's `feeTo` after pair creation has no effect on existing pairs. For a fully dynamic fee address, the pair should call `IFactory(factory).feeTo()` inside `_mintFee`.
- **No optimal ratio enforcement in Router:** `addLiquidity` does not adjust token ratios to match the current pool price. Depositing at the wrong ratio may result in leftover tokens not being deposited.
- **No deadline/expiry on swaps:** Transactions can sit in the mempool and execute at a stale price. Consider adding a `deadline` parameter.
- **`payable(msg.sender).transfer()`** is used in `swapExactTokensForETH`. Prefer `.call{value: ...}("")` with a success check for better compatibility with smart contract recipients.
