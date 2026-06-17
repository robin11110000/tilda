const { expect } = require("chai");
const { ethers } = require("hardhat");

// Demonstrates the AgentBase starter kit: invoke -> callback -> state update,
// unit-tested locally against MockAgentPlatform.
describe("PriceReactorAgent (AgentBase starter kit)", function () {
  let platform, agent, owner;
  const E = (n) => ethers.parseEther(n.toString());

  beforeEach(async () => {
    [owner] = await ethers.getSigners();

    const Plat = await ethers.getContractFactory("MockAgentPlatform");
    platform = await Plat.deploy();
    await platform.waitForDeployment();

    const A = await ethers.getContractFactory("PriceReactorAgent");
    agent = await A.deploy(platform.target, owner.address);
    await agent.waitForDeployment();

    await agent.configure("https://api.example/price", "price", 18);
    await agent.setJsonAgent(13174292974160097713n, 0); // zero cost for the mock
  });

  it("poke -> agent callback stores the value", async () => {
    await agent.poke(); // creates request id 1
    await platform.fulfillUint(1, E(2500));

    expect(await agent.lastValue()).to.equal(E(2500));
    expect(await agent.updates()).to.equal(1n);
  });

  it("ignores a failed agent response without reverting", async () => {
    await agent.poke(); // id 1
    await platform.fail(1);
    expect(await agent.updates()).to.equal(0n);
  });
});
