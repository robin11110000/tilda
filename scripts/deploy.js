const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");
const C = require("./constants");

// Deploys the full stack to the selected --network and wires it up:
//   MockERC20 (base + quote) -> OrderBook (CLOB) -> TradingAgent (AI market maker)
// Then funds the agent's inventory, sets its price source + strategy, and tops it up with STT.
async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("Network: ", network.name);
  console.log("Deployer:", deployer.address, `(${ethers.formatEther(bal)} STT)`);

  const platformAddr = process.env.PLATFORM_ADDRESS || C.PLATFORM_TESTNET;

  const Mock = await ethers.getContractFactory("MockERC20");
  const base = await Mock.deploy("Mock SOM", "mSOM");
  await base.waitForDeployment();
  const quote = await Mock.deploy("Mock USDC", "mUSDC");
  await quote.waitForDeployment();
  console.log("  base (mSOM):  ", base.target);
  console.log("  quote (mUSDC):", quote.target);

  const Book = await ethers.getContractFactory("OrderBook");
  const book = await Book.deploy(base.target, quote.target);
  await book.waitForDeployment();
  console.log("  OrderBook:    ", book.target);

  const Agent = await ethers.getContractFactory("TradingAgent");
  const agent = await Agent.deploy(book.target, platformAddr, deployer.address);
  await agent.waitForDeployment();
  console.log("  TradingAgent: ", agent.target);

  // Fund the agent's trading inventory (it must hold both tokens to quote two-sided).
  const inv = ethers.parseEther(process.env.AGENT_INVENTORY || "100000");
  await (await base.mint(agent.target, inv)).wait();
  await (await quote.mint(agent.target, inv)).wait();

  // Configure price source + strategy.
  await (
    await agent.setPriceSource(
      process.env.PRICE_URL || C.DEFAULT_PRICE_URL,
      process.env.PRICE_SELECTOR || C.DEFAULT_PRICE_SELECTOR,
      Number(process.env.PRICE_DECIMALS || C.DEFAULT_PRICE_DECIMALS)
    )
  ).wait();
  await (
    await agent.setStrategy(
      Number(process.env.SPREAD_BPS || 100),
      ethers.parseEther(process.env.ORDER_SIZE || "1")
    )
  ).wait();

  // Optional: wire the LLM inference agent (id from agents.testnet.somnia.network).
  if (process.env.LLM_AGENT_ID) {
    await (
      await agent.setLlmAgent(
        process.env.LLM_AGENT_ID,
        "You are an autonomous market maker on a CLOB. Skew price to reduce inventory imbalance; stay near the reference price.",
        "Return a single integer: the price skew in basis points."
      )
    ).wait();
    console.log("  LLM agent id set:", process.env.LLM_AGENT_ID);
  }

  // Top the agent up with STT for agent-call deposits (and the 32 STT reactivity floor if you go autonomous).
  const funding = process.env.AGENT_FUNDING || "5";
  if (Number(funding) > 0) {
    await (await deployer.sendTransaction({ to: agent.target, value: ethers.parseEther(funding) })).wait();
    console.log(`  Funded agent with ${funding} STT`);
  }

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    platform: platformAddr,
    base: base.target,
    quote: quote.target,
    book: book.target,
    agent: agent.target,
    deployer: deployer.address,
  };

  const depDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(depDir, { recursive: true });
  fs.writeFileSync(path.join(depDir, `${network.name}.json`), JSON.stringify(out, null, 2));

  const feDir = path.join(__dirname, "..", "frontend", "src");
  fs.mkdirSync(feDir, { recursive: true });
  fs.writeFileSync(path.join(feDir, "deployments.json"), JSON.stringify(out, null, 2));

  console.log("\nDeployment saved to deployments/%s.json and frontend/src/deployments.json", network.name);
  console.log("\nNext:");
  console.log("  1) node agent/orchestrator.js     # drive the agent (off-chain operator path)");
  console.log("  2) cd frontend && npm install && npm run dev   # live dashboard");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
