import hre from "hardhat";
const { ethers } = await hre.network.connect();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // 1. WETH
  const weth = await ethers.deployContract("MyWETH");
  await weth.waitForDeployment();
  console.log("WETH     :", await weth.getAddress());

  // 2. Factory  (deployer = feeToSetter)
  const factory = await ethers.deployContract("Factory", [deployer.address]);
  await factory.waitForDeployment();
  console.log("Factory  :", await factory.getAddress());

  // 3. Router
  const router = await ethers.deployContract("Router", [
    await factory.getAddress(),
    await weth.getAddress(),
  ]);
  await router.waitForDeployment();
  console.log("Router   :", await router.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });