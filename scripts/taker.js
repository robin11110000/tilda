// Optional "noise taker" — generates real fills against the agent's quotes so the demo book
// shows trades streaming in. Uses your wallet (or TAKER_PRIVATE_KEY) to mint demo tokens and
// periodically cross the spread.
//
// Run:  node scripts/taker.js
require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const RPC = process.env.RPC_URL || "https://api.infra.testnet.somnia.network/";
const PK = process.env.TAKER_PRIVATE_KEY || process.env.PRIVATE_KEY;
const INTERVAL = Number(process.env.TAKER_INTERVAL_MS || 9000);

const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "somniaTestnet.json"), "utf8"));

const ERC20 = [
  "function mint(address,uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
];
const BOOK = [
  "function getBids() view returns (tuple(uint256 id,address trader,bool isBuy,uint256 price,uint256 amount)[])",
  "function getAsks() view returns (tuple(uint256 id,address trader,bool isBuy,uint256 price,uint256 amount)[])",
  "function placeLimitOrder(bool,uint256,uint256) returns (uint256)",
];

async function main() {
  if (!PK) throw new Error("Set PRIVATE_KEY (or TAKER_PRIVATE_KEY) in .env");
  const provider = new ethers.JsonRpcProvider(RPC);
  const w = new ethers.Wallet(PK, provider);
  const base = new ethers.Contract(dep.base, ERC20, w);
  const quote = new ethers.Contract(dep.quote, ERC20, w);
  const book = new ethers.Contract(dep.book, BOOK, w);

  await (await base.mint(w.address, ethers.parseEther("1000000"))).wait();
  await (await quote.mint(w.address, ethers.parseEther("1000000"))).wait();
  await (await base.approve(dep.book, ethers.MaxUint256)).wait();
  await (await quote.approve(dep.book, ethers.MaxUint256)).wait();
  console.log("Taker ready:", w.address);

  const size = ethers.parseEther(process.env.TAKER_SIZE || "0.3");

  async function tick() {
    try {
      const [bids, asks] = await Promise.all([book.getBids(), book.getAsks()]);
      const buy = Math.random() < 0.5;
      if (buy && asks.length) {
        const best = asks.reduce((a, b) => (b.price < a.price ? b : a));
        await (await book.placeLimitOrder(true, best.price, size)).wait();
        console.log("took ask @", ethers.formatEther(best.price));
      } else if (!buy && bids.length) {
        const best = bids.reduce((a, b) => (b.price > a.price ? b : a));
        await (await book.placeLimitOrder(false, best.price, size)).wait();
        console.log("hit bid @", ethers.formatEther(best.price));
      } else {
        console.log("book empty, waiting for agent quotes…");
      }
    } catch (e) {
      console.error("taker:", e.message);
    }
  }

  setInterval(tick, INTERVAL);
}

main().catch(console.error);
