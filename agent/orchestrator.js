// Off-chain orchestrator (operator path) — the reliable demo driver.
//
// Every interval it fetches a real reference price from a public API and submits it to the
// on-chain agent via applyDecision(price, skew). The skew leans against inventory imbalance.
// This guarantees a live, moving market for the demo even while the fully on-chain agent path
// (poke -> JSON agent -> LLM agent -> quote) is being tuned on testnet.
//
// Run:  node agent/orchestrator.js
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC = process.env.RPC_URL || "https://api.infra.testnet.somnia.network/";
const PK = process.env.PRIVATE_KEY;
const INTERVAL = Number(process.env.ORCH_INTERVAL_MS || 15000);
const PRICE_API =
  process.env.ORCH_PRICE_API || "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";
const PRICE_PATH = process.env.ORCH_PRICE_PATH || "ethereum.usd";

const depPath = path.join(__dirname, "..", "deployments", "somniaTestnet.json");
if (!fs.existsSync(depPath)) {
  console.error("No deployments/somniaTestnet.json — run `npm run deploy:testnet` first.");
  process.exit(1);
}
const dep = JSON.parse(fs.readFileSync(depPath, "utf8"));

const AGENT_ABI = [
  "function applyDecision(uint256 price, int256 skewBps) external",
  "function poke() external",
  "function inventory() view returns (uint256,uint256)",
  "function lastPrice() view returns (uint256)",
];

const pick = (obj, dotted) => dotted.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);

async function main() {
  if (!PK) throw new Error("Set PRIVATE_KEY in .env");
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PK, provider);
  const agent = new ethers.Contract(dep.agent, AGENT_ABI, wallet);
  console.log(`Orchestrator driving agent ${dep.agent} as ${wallet.address}, every ${INTERVAL}ms`);

  let prevPx = null;

  async function tick() {
    try {
      const res = await fetch(PRICE_API);
      const json = await res.json();
      const px = Number(pick(json, PRICE_PATH));
      if (!px || !isFinite(px)) {
        console.log("no price from feed, skipping");
        return;
      }
      const priceWei = ethers.parseEther(px.toFixed(6));

      // Skew = inventory rebalancing + short-term momentum, so it visibly reacts to
      // both price moves and fills. (The fully on-chain path gets this skew from the LLM agent.)
      const [b, q] = await agent.inventory();
      const baseAmt = Number(ethers.formatEther(b));
      const quoteAmt = Number(ethers.formatEther(q));
      const total = baseAmt + quoteAmt || 1;
      // normalize by token AMOUNTS so real fills move it: more quote than base => skew up to buy base
      const invSkew = ((quoteAmt - baseAmt) / total) * 150;
      // lean into the recent price move
      const momentum = prevPx ? ((px - prevPx) / prevPx) * 3000 : 0;
      prevPx = px;
      let skew = Math.round(invSkew + momentum);
      skew = Math.max(-500, Math.min(500, skew));

      const tx = await agent.applyDecision(priceWei, skew);
      console.log(new Date().toISOString(), `price=${px} skew=${skew}bps tx=${tx.hash}`);
      await tx.wait();
    } catch (e) {
      console.error("tick error:", e.message);
    }
  }

  await tick();
  setInterval(tick, INTERVAL);
}

main().catch(console.error);
