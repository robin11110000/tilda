const { ethers, network } = require("hardhat");
const dep = require(`../deployments/${network.name}.json`);

// Turn on fully-autonomous mode: the agent subscribes to a Somnia Reactivity schedule that
// re-arms itself each cycle, so it runs hands-off with no keeper. Requires the agent to hold
// >= 32 STT (the reactivity owner-balance floor) — this script tops it up to ~33 STT.
//
//   INTERVAL_SECONDS=60 npx hardhat run scripts/autonomous.js --network somniaTestnet
async function main() {
  const [deployer] = await ethers.getSigners();
  const agent = await ethers.getContractAt("TradingAgent", dep.agent);
  const interval = Number(process.env.INTERVAL_SECONDS || 60);

  const bal = await ethers.provider.getBalance(dep.agent);
  const floor = ethers.parseEther("33");
  if (bal < floor) {
    const top = floor - bal;
    console.log(`Topping agent up by ${ethers.formatEther(top)} STT for the reactivity floor…`);
    await (await deployer.sendTransaction({ to: dep.agent, value: top })).wait();
  }

  const tx = await agent.startAutonomous(interval);
  await tx.wait();
  console.log(`Autonomous mode ON — agent re-arms every ${interval}s. tx: ${tx.hash}`);
  console.log("To stop: call agent.stopAutonomous() (see INSTRUCTIONS.md).");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
