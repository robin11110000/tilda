const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TradingAgent (observe -> decide -> act)", function () {
  let base, quote, book, platform, agent, owner;
  const E = (n) => ethers.parseEther(n.toString());

  beforeEach(async () => {
    [owner] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockERC20");
    base = await Mock.deploy("Mock SOM", "mSOM");
    quote = await Mock.deploy("Mock USDC", "mUSDC");
    await base.waitForDeployment();
    await quote.waitForDeployment();

    const Book = await ethers.getContractFactory("OrderBook");
    book = await Book.deploy(base.target, quote.target);
    await book.waitForDeployment();

    const Plat = await ethers.getContractFactory("MockAgentPlatform");
    platform = await Plat.deploy();
    await platform.waitForDeployment();

    const Agent = await ethers.getContractFactory("TradingAgent");
    agent = await Agent.deploy(book.target, platform.target, owner.address);
    await agent.waitForDeployment();

    // fund the agent's inventory so it can quote both sides
    await base.mint(agent.target, E(1000));
    await quote.mint(agent.target, E(1000));

    // mock platform charges nothing
    await agent.setAgentCosts(0, 0);
    await agent.setStrategy(100, E(1)); // 1% half-spread, size 1
    await agent.setPriceSource("https://api.example/price", "price", 18);
  });

  it("operator path: applyDecision places a bid and an ask around the price", async () => {
    await agent.applyDecision(E(2), 0);

    expect(await book.bidCount()).to.equal(1n);
    expect(await book.askCount()).to.equal(1n);

    const live = await agent.liveOrders();
    expect(live.length).to.equal(2);

    // bid at 2 * (1 - 1%) = 1.98, ask at 2 * (1 + 1%) = 2.02
    const bids = await book.getBids();
    const asks = await book.getAsks();
    expect(bids[0].price).to.equal(E(1.98));
    expect(asks[0].price).to.equal(E(2.02));
  });

  it("on-chain path with no LLM: a price callback triggers a neutral quote", async () => {
    await agent.poke(); // creates price request id 1 on the mock platform
    await platform.fulfillUint(1, E(2)); // deliver price = 2

    expect(await agent.lastPrice()).to.equal(E(2));
    expect(await book.bidCount()).to.equal(1n);
    expect(await book.askCount()).to.equal(1n);
  });

  it("on-chain path with LLM: price -> decision -> skewed quote", async () => {
    await agent.setLlmAgent(99, "make a market", "return skew bps");

    await agent.poke(); // price request id 1
    await platform.fulfillUint(1, E(2)); // price 2 -> agent fires decision request id 2
    await platform.fulfillInt(2, 200); // skew +200 bps (+2%)

    expect(await book.bidCount()).to.equal(1n);
    expect(await book.askCount()).to.equal(1n);

    // adj = 2 * 1.02 = 2.04 ; bid = 2.04 * 0.99 = 2.0196 ; ask = 2.04 * 1.01 = 2.0604
    const bids = await book.getBids();
    const asks = await book.getAsks();
    expect(bids[0].price).to.equal(E(2.0196));
    expect(asks[0].price).to.equal(E(2.0604));
  });

  it("re-quotes on the next cycle: old orders cancelled, new ones placed", async () => {
    await agent.applyDecision(E(2), 0);
    const firstBids = await book.getBids();
    await agent.applyDecision(E(3), 0);

    // still exactly one bid + one ask (old ones cancelled)
    expect(await book.bidCount()).to.equal(1n);
    expect(await book.askCount()).to.equal(1n);
    const newBids = await book.getBids();
    expect(newBids[0].price).to.equal(E(2.97)); // 3 * 0.99
    expect(newBids[0].id).to.not.equal(firstBids[0].id);
  });

  it("gracefully falls back to last price when an agent request fails", async () => {
    await agent.poke(); // id 1
    await platform.fulfillUint(1, E(2)); // sets lastPrice + quotes
    await agent.poke(); // id 2
    await platform.fail(2); // failure -> should re-quote off lastPrice, not revert

    expect(await book.bidCount()).to.equal(1n);
    expect(await book.askCount()).to.equal(1n);
    expect(await agent.lastPrice()).to.equal(E(2));
  });
});
