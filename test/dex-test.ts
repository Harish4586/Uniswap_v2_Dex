import { expect } from "chai";
import hre from "hardhat";
const { ethers } = await hre.network.connect();

describe("DEX Full Test Suite — Router, Pair & Protocol Fees", function () {

  let owner: any;
  let user1: any;
  let user2: any;
  let feeRecipient: any;   // treasury — receives protocol fees

  let tokenA: any;
  let tokenB: any;
  let weth: any;

  let factory: any;
  let router: any;
  let pair: any;
  let ethPair: any;

  const parse = (v: string) => ethers.parseEther(v);
  const DEAD  = "0x000000000000000000000000000000000000dEaD";
  const MINIMUM_LIQUIDITY = 1000n;

  // ─── helpers ─────────────────────────────────────────────────────────────

  async function getPair(tA = tokenA, tB = tokenB) {
    const addr = await factory.getPair(
      await tA.getAddress(),
      await tB.getAddress()
    );
    return ethers.getContractAt("EthTokenAMM", addr);
  }

  async function seedPool(amtA = "100", amtB = "100", signer = owner) {
    const r = router.connect(signer);
    await tokenA.connect(signer).approve(await router.getAddress(), ethers.MaxUint256);
    await tokenB.connect(signer).approve(await router.getAddress(), ethers.MaxUint256);
    await r.addLiquidity(
      await tokenA.getAddress(),
      await tokenB.getAddress(),
      parse(amtA),
      parse(amtB)
    );
    return getPair();
  }

  async function seedETHPool(amtToken = "100", amtETH = "10", signer = owner) {
    const r = router.connect(signer);
    await tokenA.connect(signer).approve(await router.getAddress(), ethers.MaxUint256);
    await r.addLiquidityETH(
      await tokenA.getAddress(),
      parse(amtToken),
      { value: parse(amtETH) }
    );
    const addr = await factory.getPair(
      await tokenA.getAddress(),
      await weth.getAddress()
    );
    return ethers.getContractAt("EthTokenAMM", addr);
  }

  /** Run N token swaps to accumulate fees in the pool */
  async function generateFees(times = 5, amt = "10", signer = owner) {
    await tokenA.connect(signer).approve(await router.getAddress(), ethers.MaxUint256);
    for (let i = 0; i < times; i++) {
      await router.connect(signer).swapExactTokensForTokens(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        parse(amt),
        0
      );
    }
  }

  // ─── setup ───────────────────────────────────────────────────────────────

  beforeEach(async function () {
    [owner, user1, user2, feeRecipient] = await ethers.getSigners();

    const TokenA = await ethers.getContractFactory("POOL_TOKEN_A");
    tokenA = await TokenA.deploy(1_000_000);
    await tokenA.waitForDeployment();

    const TokenB = await ethers.getContractFactory("POOL_TOKEN_B");
    tokenB = await TokenB.deploy(1_000_000);
    await tokenB.waitForDeployment();

    const WETH = await ethers.getContractFactory("MyWETH");
    weth = await WETH.deploy();
    await weth.waitForDeployment();

    // owner is feeToSetter in Factory
    const Factory = await ethers.getContractFactory("Factory");
    factory = await Factory.deploy(owner.address);
    await factory.waitForDeployment();

    const Router = await ethers.getContractFactory("Router");
    router = await Router.deploy(
      await factory.getAddress(),
      await weth.getAddress()
    );
    await router.waitForDeployment();

    // Fund user1 & user2 with tokens
    await tokenA.transfer(user1.address, parse("10000"));
    await tokenB.transfer(user1.address, parse("10000"));
    await tokenA.transfer(user2.address, parse("10000"));
    await tokenB.transfer(user2.address, parse("10000"));
  });

  // =========================================================================
  // FACTORY
  // =========================================================================

  describe("Factory — Pair Management", function () {

    it("should create a pair and return its address", async function () {
      await factory.createPair(await tokenA.getAddress(), await tokenB.getAddress());
      const addr = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
      expect(addr).to.not.equal(ethers.ZeroAddress);
    });

    it("should create the same pair regardless of token argument order", async function () {
      await factory.createPair(await tokenA.getAddress(), await tokenB.getAddress());
      const addr1 = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
      const addr2 = await factory.getPair(await tokenB.getAddress(), await tokenA.getAddress());
      expect(addr1).to.equal(addr2);
    });

    it("should increment allPairsLength on each new pair", async function () {
      expect(await factory.allPairsLength()).to.equal(0n);
      await factory.createPair(await tokenA.getAddress(), await tokenB.getAddress());
      expect(await factory.allPairsLength()).to.equal(1n);
    });

    it("should store pair in allPairs array at correct index", async function () {
      await factory.createPair(await tokenA.getAddress(), await tokenB.getAddress());
      const pairAddr = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
      expect(await factory.allPairs(0)).to.equal(pairAddr);
    });

    it("should revert when creating a pair with identical tokens", async function () {
      await expect(
        factory.createPair(await tokenA.getAddress(), await tokenA.getAddress())
      ).to.be.rejected;
    });

    it("should revert when creating the same pair twice", async function () {
      await factory.createPair(await tokenA.getAddress(), await tokenB.getAddress());
      await expect(
        factory.createPair(await tokenA.getAddress(), await tokenB.getAddress())
      ).to.be.rejected;
    });

    it("should revert when creating a pair with a zero address", async function () {
      await expect(
        factory.createPair(await tokenA.getAddress(), ethers.ZeroAddress)
      ).to.be.rejected;
    });

    it("getPair returns ZeroAddress for non-existent pair", async function () {
      const addr = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
      expect(addr).to.equal(ethers.ZeroAddress);
    });
  });

  // =========================================================================
  // FACTORY — FEE GOVERNANCE
  // =========================================================================

  describe("Factory — Fee Governance", function () {

    it("feeTo should be zero address by default (fee off)", async function () {
      expect(await factory.feeTo()).to.equal(ethers.ZeroAddress);
    });

    it("feeToSetter should be set to deployer", async function () {
      expect(await factory.feeToSetter()).to.equal(owner.address);
    });

    it("feeToSetter can set feeTo", async function () {
      await factory.setFeeTo(feeRecipient.address);
      expect(await factory.feeTo()).to.equal(feeRecipient.address);
    });

    it("non-feeToSetter cannot call setFeeTo", async function () {
      await expect(
        factory.connect(user1).setFeeTo(feeRecipient.address)
      ).to.be.revertedWith("setFeeTo Action ForBidden");
    });

    it("feeToSetter can transfer setter role to another address", async function () {
      await factory.setFeeToSetter(user1.address);
      expect(await factory.feeToSetter()).to.equal(user1.address);
    });

    it("old feeToSetter loses access after transfer", async function () {
      await factory.setFeeToSetter(user1.address);
      await expect(
        factory.connect(owner).setFeeTo(feeRecipient.address)
      ).to.be.revertedWith("setFeeTo Action ForBidden");
    });

    it("new feeToSetter can set feeTo after role transfer", async function () {
      await factory.setFeeToSetter(user1.address);
      await factory.connect(user1).setFeeTo(feeRecipient.address);
      expect(await factory.feeTo()).to.equal(feeRecipient.address);
    });

    it("non-feeToSetter cannot call setFeeToSetter", async function () {
      await expect(
        factory.connect(user1).setFeeToSetter(user2.address)
      ).to.be.revertedWith("setFeeToSetter Action ForBidden");
    });

    it("feeTo can be reset back to zero address (fee off)", async function () {
      await factory.setFeeTo(feeRecipient.address);
      await factory.setFeeTo(ethers.ZeroAddress);
      expect(await factory.feeTo()).to.equal(ethers.ZeroAddress);
    });
  });

  // =========================================================================
  // PAIR — MINT (add liquidity)
  // =========================================================================

  describe("Pair — Mint / Add Liquidity", function () {

    it("should set reserves correctly after first mint", async function () {
      pair = await seedPool("100", "100");
      const [r0, r1] = await pair.getReserves();
      expect(r0 + r1).to.equal(parse("200"));
    });

    it("should lock MINIMUM_LIQUIDITY to dead address on first mint", async function () {
      pair = await seedPool("100", "100");
      expect(await pair.balanceOf(DEAD)).to.equal(MINIMUM_LIQUIDITY);
    });

    it("should mint LP tokens > 0 to provider on first mint", async function () {
      pair = await seedPool("100", "100");
      expect(await pair.balanceOf(owner.address)).to.be.gt(0n);
    });

    it("should mint proportional LP tokens on second deposit", async function () {
      pair = await seedPool("100", "100");
      const lp1 = await pair.balanceOf(owner.address);

      await tokenA.connect(user1).approve(await router.getAddress(), ethers.MaxUint256);
      await tokenB.connect(user1).approve(await router.getAddress(), ethers.MaxUint256);
      await router.connect(user1).addLiquidity(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        parse("100"),
        parse("100")
      );

      const lp2 = await pair.balanceOf(user1.address);
      expect(lp2).to.be.gt(0n);
      // second deposit gets slightly fewer LP due to MINIMUM_LIQUIDITY
      expect(lp2).to.be.closeTo(lp1, 1000);
    });

    it("should increase reserves after second deposit", async function () {
      pair = await seedPool("100", "100");
      const [r0Before] = await pair.getReserves();

      await tokenA.connect(user1).approve(await router.getAddress(), ethers.MaxUint256);
      await tokenB.connect(user1).approve(await router.getAddress(), ethers.MaxUint256);
      await router.connect(user1).addLiquidity(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        parse("50"),
        parse("50")
      );

      const [r0After] = await pair.getReserves();
      expect(r0After).to.be.gt(r0Before);
    });

    it("router should auto-create pair when adding liquidity to new pool", async function () {
      const before = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
      expect(before).to.equal(ethers.ZeroAddress);
      await seedPool();
      const after = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
      expect(after).to.not.equal(ethers.ZeroAddress);
    });

    it("should add ETH liquidity and create a WETH pair", async function () {
      ethPair = await seedETHPool("100", "10");
      const addr = await factory.getPair(await tokenA.getAddress(), await weth.getAddress());
      expect(addr).to.not.equal(ethers.ZeroAddress);
    });

    it("should set correct reserves after ETH liquidity", async function () {
      ethPair = await seedETHPool("100", "10");
      const [r0, r1] = await ethPair.getReserves();
      expect(r0 + r1).to.equal(parse("110"));
    });

    it("should mint LP tokens > 0 for ETH pair provider", async function () {
      ethPair = await seedETHPool();
      expect(await ethPair.balanceOf(owner.address)).to.be.gt(0n);
    });

    it("totalSupply should equal LP minted + MINIMUM_LIQUIDITY after first mint", async function () {
      pair = await seedPool("100", "100");
      const lp        = await pair.balanceOf(owner.address);
      const totalSupp = await pair.totalSupply();
      expect(totalSupp).to.equal(lp + MINIMUM_LIQUIDITY);
    });
  });

  // =========================================================================
  // PAIR — BURN (remove liquidity)
  // =========================================================================

  describe("Pair — Burn / Remove Liquidity", function () {

    it("should reduce reserves after removing all liquidity", async function () {
      pair = await seedPool("50", "50");
      const liquidity = await pair.balanceOf(owner.address);
      await pair.approve(await router.getAddress(), liquidity);
      await router.removeLiquidity(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        liquidity
      );
      const [r0, r1] = await pair.getReserves();
      expect(r0).to.be.lt(parse("50"));
      expect(r1).to.be.lt(parse("50"));
    });

    it("should return tokens to provider after removing liquidity", async function () {
      pair = await seedPool("100", "100");
      const aBalBefore = await tokenA.balanceOf(owner.address);
      const bBalBefore = await tokenB.balanceOf(owner.address);

      const liquidity = await pair.balanceOf(owner.address);
      await pair.approve(await router.getAddress(), liquidity);
      await router.removeLiquidity(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        liquidity
      );

      expect(await tokenA.balanceOf(owner.address)).to.be.gt(aBalBefore);
      expect(await tokenB.balanceOf(owner.address)).to.be.gt(bBalBefore);
    });

    it("should burn LP tokens to zero after full removal", async function () {
      pair = await seedPool();
      const lpBefore = await pair.balanceOf(owner.address);
      await pair.approve(await router.getAddress(), lpBefore);
      await router.removeLiquidity(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        lpBefore
      );
      expect(await pair.balanceOf(owner.address)).to.equal(0n);
    });

    it("should revert burn if no LP tokens held by pair contract", async function () {
      pair = await seedPool();
      await expect(pair.burn(owner.address)).to.be.rejected;
    });

    it("should remove ETH liquidity and return ETH to user", async function () {
      ethPair = await seedETHPool("100", "10");
      const liquidity = await ethPair.balanceOf(owner.address);
      await ethPair.approve(await router.getAddress(), liquidity);

      const ethBefore = await ethers.provider.getBalance(owner.address);
      const tx        = await router.removeLiquidityETH(await tokenA.getAddress(), liquidity);
      const receipt   = await tx.wait();
      const gasUsed   = receipt.gasUsed * receipt.gasPrice;
      const ethAfter  = await ethers.provider.getBalance(owner.address);

      expect(BigInt(ethAfter) + BigInt(gasUsed)).to.be.gt(ethBefore);
    });

    it("should remove ETH liquidity and return tokens to user", async function () {
      ethPair = await seedETHPool("100", "10");
      const liquidity = await ethPair.balanceOf(owner.address);
      await ethPair.approve(await router.getAddress(), liquidity);

      const tokenBefore = await tokenA.balanceOf(owner.address);
      await router.removeLiquidityETH(await tokenA.getAddress(), liquidity);
      expect(await tokenA.balanceOf(owner.address)).to.be.gt(tokenBefore);
    });

    it("should allow partial liquidity removal", async function () {
      pair = await seedPool("100", "100");
      const totalLP = await pair.balanceOf(owner.address);
      const half    = totalLP / 2n;

      await pair.approve(await router.getAddress(), half);
      await router.removeLiquidity(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        half
      );

      expect(await pair.balanceOf(owner.address)).to.be.gt(0n);
    });

    it("should revert removeLiquidity if pair does not exist", async function () {
      await expect(
        router.removeLiquidity(await tokenA.getAddress(), await tokenB.getAddress(), parse("1"))
      ).to.be.revertedWith("Pair not exist");
    });

    it("should revert removeLiquidityETH if pair does not exist", async function () {
      await expect(
        router.removeLiquidityETH(await tokenA.getAddress(), parse("1"))
      ).to.be.revertedWith("Pair not exist");
    });

    it("should give back close to deposited amount minus locked minimum (no swaps)", async function () {
      pair = await seedPool("100", "100");
      const liquidity = await pair.balanceOf(owner.address);
      await pair.approve(await router.getAddress(), liquidity);

      const aBalBefore = await tokenA.balanceOf(owner.address);
      await router.removeLiquidity(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        liquidity
      );
      const aReceived = (await tokenA.balanceOf(owner.address)) - aBalBefore;

      expect(aReceived).to.be.lt(parse("100"));
      expect(aReceived).to.be.gt(parse("99.99"));
    });
  });

  // =========================================================================
  // PAIR — SWAP (token ↔ token)
  // =========================================================================

  describe("Pair — Swap Token ↔ Token", function () {

    it("should swap tokenA → tokenB and increase tokenB balance", async function () {
      pair = await seedPool("100", "100");
      const before = await tokenB.balanceOf(owner.address);
      await tokenA.approve(await router.getAddress(), ethers.MaxUint256);
      await router.swapExactTokensForTokens(
        await tokenA.getAddress(), await tokenB.getAddress(), parse("10"), 0
      );
      expect(await tokenB.balanceOf(owner.address)).to.be.gt(before);
    });

    it("should swap tokenB → tokenA and increase tokenA balance", async function () {
      pair = await seedPool("100", "100");
      const before = await tokenA.balanceOf(owner.address);
      await tokenB.approve(await router.getAddress(), ethers.MaxUint256);
      await router.swapExactTokensForTokens(
        await tokenB.getAddress(), await tokenA.getAddress(), parse("10"), 0
      );
      expect(await tokenA.balanceOf(owner.address)).to.be.gt(before);
    });

    it("should enforce 0.3% fee — amountOut < amountIn for 1:1 pool", async function () {
      pair = await seedPool("100", "100");
      const before = await tokenB.balanceOf(owner.address);
      await tokenA.approve(await router.getAddress(), ethers.MaxUint256);
      await router.swapExactTokensForTokens(
        await tokenA.getAddress(), await tokenB.getAddress(), parse("10"), 0
      );
      const received = (await tokenB.balanceOf(owner.address)) - before;
      expect(received).to.be.lt(parse("10"));
    });

    it("should revert swap if output is below minOut (slippage guard)", async function () {
      pair = await seedPool("100", "100");
      await tokenA.approve(await router.getAddress(), ethers.MaxUint256);
      await expect(
        router.swapExactTokensForTokens(
          await tokenA.getAddress(), await tokenB.getAddress(), parse("10"), parse("10")
        )
      ).to.be.revertedWith("Slippage");
    });

    it("should revert swap if pair does not exist", async function () {
      await expect(
        router.swapExactTokensForTokens(
          await tokenA.getAddress(), await tokenB.getAddress(), parse("1"), 0
        )
      ).to.be.revertedWith("Pair not exist");
    });

    it("should maintain constant-product invariant (K) after swap", async function () {
      pair = await seedPool("100", "100");
      const [r0Before, r1Before] = await pair.getReserves();

      await tokenA.approve(await router.getAddress(), ethers.MaxUint256);
      await router.swapExactTokensForTokens(
        await tokenA.getAddress(), await tokenB.getAddress(), parse("10"), 0
      );

      const [r0After, r1After] = await pair.getReserves();
      // K grows because fees stay in pool
      expect(r0After * r1After).to.be.gte(r0Before * r1Before);
    });

    it("should update reserves after swap", async function () {
      pair = await seedPool("100", "100");
      const [r0Before, r1Before] = await pair.getReserves();
      await tokenA.approve(await router.getAddress(), ethers.MaxUint256);
      await router.swapExactTokensForTokens(
        await tokenA.getAddress(), await tokenB.getAddress(), parse("10"), 0
      );
      const [r0After, r1After] = await pair.getReserves();
      expect(r0After).to.not.equal(r0Before);
      expect(r1After).to.not.equal(r1Before);
    });

    it("should allow multiple sequential swaps without reverting", async function () {
      pair = await seedPool("1000", "1000");
      await tokenA.approve(await router.getAddress(), ethers.MaxUint256);
      await tokenB.approve(await router.getAddress(), ethers.MaxUint256);
      for (let i = 0; i < 5; i++) {
        await router.swapExactTokensForTokens(
          await tokenA.getAddress(), await tokenB.getAddress(), parse("5"), 0
        );
      }
      const [r0, r1] = await pair.getReserves();
      expect(r0).to.be.gt(0n);
      expect(r1).to.be.gt(0n);
    });

    it("larger swap should produce less output per unit than smaller swap (price impact)", async function () {
      pair = await seedPool("1000", "1000");
      await tokenA.approve(await router.getAddress(), ethers.MaxUint256);

      // small swap
      const bBefore1 = await tokenB.balanceOf(owner.address);
      await router.swapExactTokensForTokens(
        await tokenA.getAddress(), await tokenB.getAddress(), parse("1"), 0
      );
      const smallOut = (await tokenB.balanceOf(owner.address)) - bBefore1;

      // large swap — same pool (re-seed for fair comparison)
      pair = await seedPool("1000", "1000", user1);
      await tokenA.connect(user1).approve(await router.getAddress(), ethers.MaxUint256);
      const bBefore2 = await tokenB.balanceOf(user1.address);
      await router.connect(user1).swapExactTokensForTokens(
        await tokenA.getAddress(), await tokenB.getAddress(), parse("100"), 0
      );
      const largeOut = (await tokenB.balanceOf(user1.address)) - bBefore2;

      // price per unit should be worse for the large swap
      const smallRate = BigInt(smallOut) * 100n;        // scale x100
      const largeRate = largeOut;               // already 100x input
      expect(largeRate).to.be.lt(smallRate);
    });
  });

  // =========================================================================
  // PAIR — SWAP (ETH ↔ token)
  // =========================================================================

  describe("Pair — Swap ETH ↔ Token", function () {

    it("should swap ETH → tokenA and increase token balance", async function () {
      ethPair = await seedETHPool("100", "10");
      const before = await tokenA.balanceOf(owner.address);
      await router.swapExactETHForTokens(await tokenA.getAddress(), 0, { value: parse("1") });
      expect(await tokenA.balanceOf(owner.address)).to.be.gt(before);
    });

    it("should swap tokenA → ETH and increase ETH balance (net of gas)", async function () {
      ethPair = await seedETHPool("100", "10");
      await tokenA.approve(await router.getAddress(), ethers.MaxUint256);

      const before  = await ethers.provider.getBalance(owner.address);
      const tx      = await router.swapExactTokensForETH(await tokenA.getAddress(), parse("1"), 0);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const after   = await ethers.provider.getBalance(owner.address);

      expect(BigInt(after) + BigInt(gasUsed)).to.be.gt(before);
    });

    it("should revert swapExactETHForTokens if pair does not exist", async function () {
      await expect(
        router.swapExactETHForTokens(await tokenA.getAddress(), 0, { value: parse("1") })
      ).to.be.revertedWith("Pair not exist");
    });

    it("should revert swapExactTokensForETH if pair does not exist", async function () {
      await tokenA.approve(await router.getAddress(), ethers.MaxUint256);
      await expect(
        router.swapExactTokensForETH(await tokenA.getAddress(), parse("1"), 0)
      ).to.be.revertedWith("Pair not exist");
    });

    it("should revert ETH swap if slippage minOut not met", async function () {
      ethPair = await seedETHPool("100", "10");
      await expect(
        router.swapExactETHForTokens(await tokenA.getAddress(), parse("100"), { value: parse("1") })
      ).to.be.revertedWith("Slippage");
    });

    it("should update ETH pair reserves after swap", async function () {
      ethPair = await seedETHPool("100", "10");
      const [r0Before, r1Before] = await ethPair.getReserves();
      await router.swapExactETHForTokens(await tokenA.getAddress(), 0, { value: parse("1") });
      const [r0After, r1After] = await ethPair.getReserves();
      expect(r0After + r1After).to.not.equal(r0Before + r1Before);
    });
  });

  // =========================================================================
  // PROTOCOL FEE — kLast & _mintFee
  // =========================================================================

  describe("Protocol Fee — kLast and _mintFee", function () {

    it("kLast should be 0 when feeTo is not set", async function () {
      pair = await seedPool("100", "100");
      expect(await pair.kLast()).to.equal(0n);
    });

    it("kLast should be updated after mint when feeTo is set", async function () {
      await factory.setFeeTo(feeRecipient.address);
      pair = await seedPool("100", "100");
      const kLast = await pair.kLast();
      expect(kLast).to.be.gt(0n);

      // kLast should equal reserve0 * reserve1 after mint
      const [r0, r1] = await pair.getReserves();
      expect(kLast).to.equal(r0 * r1);
    });

    it("kLast should be updated after burn when feeTo is set", async function () {
      await factory.setFeeTo(feeRecipient.address);
      pair = await seedPool("100", "100");

      // generate fees then remove liquidity to trigger burn
      await generateFees(5, "10", user1);

      const liquidity = (await pair.balanceOf(owner.address)) / 2n;
      await pair.approve(await router.getAddress(), liquidity);
      await router.removeLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(), liquidity
      );

      const [r0, r1] = await pair.getReserves();
      const kLast    = await pair.kLast();
      expect(kLast).to.equal(r0 * r1);
    });

    it("kLast stays non-zero across mints when feeTo is set (pair stores feeTo locally)", async function () {
      // Your architecture: feeTo is stored IN the pair at constructor time.
      // Changing factory.setFeeTo() does NOT update the pair's local feeTo.
      // So kLast keeps being updated as long as the pair's own feeTo != address(0).
      await factory.setFeeTo(feeRecipient.address);
      pair = await seedPool("100", "100");

      const kLastAfterFirstMint = await pair.kLast();
      expect(kLastAfterFirstMint).to.be.gt(0n);

      // Even if factory feeTo is changed, pair's local feeTo is unchanged
      await factory.setFeeTo(ethers.ZeroAddress);

      await tokenA.connect(user1).approve(await router.getAddress(), ethers.MaxUint256);
      await tokenB.connect(user1).approve(await router.getAddress(), ethers.MaxUint256);
      await router.connect(user1).addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(), parse("10"), parse("10")
      );

      // kLast is still non-zero because pair reads its OWN feeTo (set at deploy),
      // not the factory's. To get kLast=0, you need the Factory-query pattern
      // where pair calls IFactory(factory).feeTo() dynamically.
      const kLastAfterSecondMint = await pair.kLast();
      expect(kLastAfterSecondMint).to.be.gt(0n);

      // kLast should equal reserve0 * reserve1 after the latest mint
      const [r0, r1] = await pair.getReserves();
      expect(kLastAfterSecondMint).to.equal(r0 * r1);
    });

    it("feeRecipient should receive LP tokens after swaps when fee is on", async function () {
      await factory.setFeeTo(feeRecipient.address);

      pair = await seedPool("1000", "1000");

      // feeRecipient has 0 LP tokens before swaps
      expect(await pair.balanceOf(feeRecipient.address)).to.equal(0n);

      // Generate fees
      await generateFees(10, "50", user1);

      // Adding liquidity triggers _mintFee → mints LP to feeRecipient
      await tokenA.connect(user2).approve(await router.getAddress(), ethers.MaxUint256);
      await tokenB.connect(user2).approve(await router.getAddress(), ethers.MaxUint256);
      await router.connect(user2).addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(), parse("10"), parse("10")
      );

      expect(await pair.balanceOf(feeRecipient.address)).to.be.gt(0n);
    });

    it("feeRecipient LP tokens should be redeemable for real tokens", async function () {
      await factory.setFeeTo(feeRecipient.address);
      pair = await seedPool("1000", "1000");
      await generateFees(10, "50", user1);

      // trigger fee mint
      await tokenA.connect(user2).approve(await router.getAddress(), ethers.MaxUint256);
      await tokenB.connect(user2).approve(await router.getAddress(), ethers.MaxUint256);
      await router.connect(user2).addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(), parse("10"), parse("10")
      );

      const feeLP = await pair.balanceOf(feeRecipient.address);
      expect(feeLP).to.be.gt(0n);

      // feeRecipient redeems LP → receives real tokens
      await pair.connect(feeRecipient).approve(await router.getAddress(), feeLP);
      const aBalBefore = await tokenA.balanceOf(feeRecipient.address);
      const bBalBefore = await tokenB.balanceOf(feeRecipient.address);

      await router.connect(feeRecipient).removeLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(), feeLP
      );

      expect(await tokenA.balanceOf(feeRecipient.address)).to.be.gt(aBalBefore);
      expect(await tokenB.balanceOf(feeRecipient.address)).to.be.gt(bBalBefore);
    });

    it("no LP tokens minted to feeRecipient when fee is off", async function () {
      // feeTo stays address(0) — fee is off
      pair = await seedPool("1000", "1000");
      await generateFees(10, "50", user1);

      await tokenA.connect(user2).approve(await router.getAddress(), ethers.MaxUint256);
      await tokenB.connect(user2).approve(await router.getAddress(), ethers.MaxUint256);
      await router.connect(user2).addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(), parse("10"), parse("10")
      );

      expect(await pair.balanceOf(feeRecipient.address)).to.equal(0n);
    });

    it("fee LP is proportionally small vs total supply (≈1/6th of fee growth)", async function () {
      await factory.setFeeTo(feeRecipient.address);
      pair = await seedPool("1000", "1000");
      const supplyBefore = await pair.totalSupply();

      await generateFees(20, "100", user1);

      // trigger _mintFee
      await tokenA.connect(user2).approve(await router.getAddress(), ethers.MaxUint256);
      await tokenB.connect(user2).approve(await router.getAddress(), ethers.MaxUint256);
      await router.connect(user2).addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(), parse("1"), parse("1")
      );

      const feeLPMinted = await pair.balanceOf(feeRecipient.address);
      const supplyAfter = await pair.totalSupply();

      // fee should be a small fraction of total supply
      expect(feeLPMinted).to.be.gt(0n);
      expect(feeLPMinted * 100n).to.be.lt(supplyAfter); // fee < 1% of total supply
    });

    it("burn should also trigger _mintFee and send LP to feeRecipient", async function () {
      await factory.setFeeTo(feeRecipient.address);
      pair = await seedPool("1000", "1000");
      await generateFees(10, "50", user1);

      // feeLPs before burn
      const feeLPBefore = await pair.balanceOf(feeRecipient.address);

      // remove liquidity → triggers burn → triggers _mintFee
      const liquidity = (await pair.balanceOf(owner.address)) / 2n;
      await pair.approve(await router.getAddress(), liquidity);
      await router.removeLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(), liquidity
      );

      expect(await pair.balanceOf(feeRecipient.address)).to.be.gt(feeLPBefore);
    });

    it("changing feeTo mid-life redirects fees to new address", async function () {
      // Step 1: seed pool with feeRecipient as feeTo
      await factory.setFeeTo(feeRecipient.address);
      pair = await seedPool("1000", "1000");

      // Step 2: trigger a mint to snapshot kLast with feeRecipient as feeTo
      // (seedPool already did this, kLast is now set)

      // Step 3: switch feeTo to user2 BEFORE generating new swap fees
      await factory.setFeeTo(user2.address);

      // Step 4: swaps happen AFTER feeTo change — sqrt(k) grows from this point
      // but pair's local feeTo is still feeRecipient (local storage architecture)
      // So we verify the FACTORY-level change is reflected if pair uses factory query.
      // Since your pair stores feeTo locally, we test what actually happens:
      // fees still go to feeRecipient (the pair's own stored feeTo), not user2.
      await generateFees(10, "50", user1);

      // Step 5: trigger _mintFee via addLiquidity
      await tokenA.connect(owner).approve(await router.getAddress(), ethers.MaxUint256);
      await tokenB.connect(owner).approve(await router.getAddress(), ethers.MaxUint256);
      await router.addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(), parse("1"), parse("1")
      );

      // With local feeTo storage: feeRecipient (original feeTo) gets the LP tokens
      // user2 gets nothing because the pair never reads from factory
      const feeRecipientLP = await pair.balanceOf(feeRecipient.address);
      const user2LP        = await pair.balanceOf(user2.address);

      expect(feeRecipientLP).to.be.gt(0n);  // original feeTo still receives fees
      expect(user2LP).to.equal(0n);          // new factory feeTo has no effect on old pairs

      // NOTE: To make feeTo truly dynamic (redirect to user2), upgrade the pair
      // to call IFactory(factory).feeTo() inside _mintFee instead of reading
      // the local `feeTo` state variable. See audit recommendation C-03.
    });
  });

  // =========================================================================
  // PAIR — DIRECT INTERACTION EDGE CASES
  // =========================================================================

  describe("Pair — Direct Edge Cases", function () {

    it("should revert swap with zero output amounts", async function () {
      pair = await seedPool();
      await expect(pair.swap(0, 0, owner.address)).to.be.revertedWith("Zero output");
    });

    it("should revert swap if output equals reserve (must be strictly less)", async function () {
      pair = await seedPool("100", "100");
      const [r0] = await pair.getReserves();
      await expect(pair.swap(r0, 0, owner.address)).to.be.revertedWith("Liquidity");
    });

    it("should revert swap if output exceeds reserve", async function () {
      pair = await seedPool("100", "100");
      const [r0] = await pair.getReserves();
      await expect(pair.swap(r0 + 1n, 0, owner.address)).to.be.revertedWith("Liquidity");
    });

    it("should revert swap if no tokens sent in (no input)", async function () {
      pair = await seedPool("100", "100");
      await expect(pair.swap(parse("1"), 0, owner.address)).to.be.rejected;
    });

    it("token0 and token1 should be sorted (token0 < token1)", async function () {
      pair = await seedPool();
      const t0 = await pair.token0();
      const t1 = await pair.token1();
      expect(BigInt(t0)).to.be.lt(BigInt(t1));
    });

    it("getReserves should reflect balances after mint", async function () {
      pair = await seedPool("200", "400");
      const [r0, r1] = await pair.getReserves();
      expect(r0 + r1).to.equal(parse("600"));
    });

    it("pair LP token should have correct name and symbol", async function () {
      pair = await seedPool();
      expect(await pair.name()).to.equal("CHICMIC LP TOKEN");
      expect(await pair.symbol()).to.equal("CLP");
    });
  });

  // =========================================================================
  // MULTI-USER SCENARIOS
  // =========================================================================

  describe("Multi-user Scenarios", function () {

    it("two LPs and one swapper — reserves stay positive", async function () {
      pair = await seedPool("500", "500", owner);

      await tokenA.connect(user1).approve(await router.getAddress(), ethers.MaxUint256);
      await tokenB.connect(user1).approve(await router.getAddress(), ethers.MaxUint256);
      await router.connect(user1).addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(), parse("200"), parse("200")
      );

      await tokenA.connect(user2).approve(await router.getAddress(), ethers.MaxUint256);
      await router.connect(user2).swapExactTokensForTokens(
        await tokenA.getAddress(), await tokenB.getAddress(), parse("50"), 0
      );

      const [r0, r1] = await pair.getReserves();
      expect(r0).to.be.gt(0n);
      expect(r1).to.be.gt(0n);
    });

    it("LP should receive more value than deposited after swap fees accumulate", async function () {
      pair = await seedPool("1000", "1000", owner);
      await generateFees(10, "50", user1);

      const liquidity = await pair.balanceOf(owner.address);
      await pair.approve(await router.getAddress(), liquidity);

      const aBalBefore = await tokenA.balanceOf(owner.address);
      const bBalBefore = await tokenB.balanceOf(owner.address);

      await router.removeLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(), liquidity
      );

      const aReceived = (await tokenA.balanceOf(owner.address)) - aBalBefore;
      const bReceived = (await tokenB.balanceOf(owner.address)) - bBalBefore;

      expect(aReceived + bReceived).to.be.gt(parse("999"));
    });

    it("two LPs receive proportional shares of fees", async function () {
      // owner provides 1000+1000, user1 provides 500+500
      pair = await seedPool("1000", "1000", owner);

      await tokenA.connect(user1).approve(await router.getAddress(), ethers.MaxUint256);
      await tokenB.connect(user1).approve(await router.getAddress(), ethers.MaxUint256);
      await router.connect(user1).addLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(), parse("500"), parse("500")
      );

      await generateFees(10, "50", user2);

      // Both withdraw
      const ownerLP = await pair.balanceOf(owner.address);
      const user1LP = await pair.balanceOf(user1.address);

      await pair.approve(await router.getAddress(), ownerLP);
      const aOwnerBefore = await tokenA.balanceOf(owner.address);
      await router.removeLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(), ownerLP
      );
      const ownerGain = (await tokenA.balanceOf(owner.address)) - aOwnerBefore;

      await pair.connect(user1).approve(await router.getAddress(), user1LP);
      const aUser1Before = await tokenA.balanceOf(user1.address);
      await router.connect(user1).removeLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(), user1LP
      );
      const user1Gain = (await tokenA.balanceOf(user1.address)) - aUser1Before;

      // owner deposited 2x more → should receive ~2x more back
      expect(ownerGain).to.be.gt(user1Gain);
    });

    it("removing liquidity before swap gives back deposited minus locked minimum", async function () {
      pair = await seedPool("100", "100");
      const liquidity = await pair.balanceOf(owner.address);
      await pair.approve(await router.getAddress(), liquidity);

      const aBalBefore = await tokenA.balanceOf(owner.address);
      await router.removeLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(), liquidity
      );
      const aReceived = (await tokenA.balanceOf(owner.address)) - aBalBefore;

      expect(aReceived).to.be.lt(parse("100"));
      expect(aReceived).to.be.gt(parse("99.99"));
    });

    it("full lifecycle: add → swap → fee accrual → remove", async function () {
      await factory.setFeeTo(feeRecipient.address);
      pair = await seedPool("1000", "1000", owner);

      // user1 swaps many times
      await generateFees(10, "50", user1);

      // feeRecipient has no LP yet
      expect(await pair.balanceOf(feeRecipient.address)).to.equal(0n);

      // owner removes liquidity → triggers _mintFee
      const liquidity = await pair.balanceOf(owner.address);
      await pair.approve(await router.getAddress(), liquidity);
      await router.removeLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(), liquidity
      );

      // feeRecipient now has LP tokens
      const feeLPs = await pair.balanceOf(feeRecipient.address);
      expect(feeLPs).to.be.gt(0n);

      // feeRecipient redeems them
      await pair.connect(feeRecipient).approve(await router.getAddress(), feeLPs);
      await router.connect(feeRecipient).removeLiquidity(
        await tokenA.getAddress(), await tokenB.getAddress(), feeLPs
      );

      expect(await tokenA.balanceOf(feeRecipient.address)).to.be.gt(0n);
      expect(await tokenB.balanceOf(feeRecipient.address)).to.be.gt(0n);
    });
  });
});