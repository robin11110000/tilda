const { ethers, network } = require("hardhat");
const dep = require(`../deployments/${network.name}.json`);

// Re-configure a deployed TradingAgent without redeploying.
// Useful to set the LLM agent id once you have it, or change the price source / strategy.
//   LLM_AGENT_ID=... npx hardhat run scripts/configure.js --network somniaTestnet
async function main() {
  const agent = await ethers.getContractAt("TradingAgent", dep.agent);

  if (process.env.LLM_AGENT_ID) {
    await (
      await agent.setLlmAgent(
        process.env.LLM_AGENT_ID,
        process.env.LLM_PROMPT ||
          "You are an autonomous market maker on a CLOB. Skew price to reduce inventory imbalance; stay near the reference price.",
        process.env.LLM_SYSTEM || "Return a single integer: the price skew in basis points."
      )
    ).wait();
    console.log("LLM agent id set to", process.env.LLM_AGENT_ID);
  }

  if (process.env.PRICE_URL) {
    await (
      await agent.setPriceSource(
        process.env.PRICE_URL,
        process.env.PRICE_SELECTOR,
        Number(process.env.PRICE_DECIMALS || 18)
      )
    ).wait();
    console.log("price source updated");
  }

  if (process.env.SPREAD_BPS || process.env.ORDER_SIZE) {
    await (
      await agent.setStrategy(
        Number(process.env.SPREAD_BPS || 100),
        ethers.parseEther(process.env.ORDER_SIZE || "1")
      )
    ).wait();
    console.log("strategy updated");
  }

  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
