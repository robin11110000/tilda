# Run guide (Windsurf)

Everything below runs in the **Windsurf integrated terminal** (`` Ctrl+` `` to open one; use the `+` to open more — you'll want ~3 terminals at the end: orchestrator, taker, frontend).

Project root for all root commands: `C:\Users\ashwi\OneDrive\Desktop\somnia`.

---

## 0. Prerequisites (already true on your machine)

- Node.js + npm ✔ (Node 23 works; Hardhat prints an "unsupported version" warning you can ignore. If anything misbehaves, install Node 20 LTS.)
- Git ✔
- Dependencies already installed. If you ever start fresh: `npm install`.

---

## 1. Create your `.env`

In the project root, copy the example and add your wallet key:

```bash
cp .env.example .env
```

Then open `.env` in Windsurf and set:

```
RPC_URL=https://api.infra.testnet.somnia.network/
PRIVATE_KEY=0x<private key for wallet 0x46298E5974ec2F6665675cDF6De2e755b3BA02CB>
```

> `.env` is gitignored — it never leaves your machine. The wallet needs STT (you have 155).

---

## 2. Run the tests (proves the contracts work)

```bash
npm test
```

Expect **8 passing** (3 OrderBook + 5 TradingAgent). The first compile is slow (~1–2 min) because the `viaIR` pipeline is on — that's normal.

---

## 3. Deploy to Somnia Shannon testnet

```bash
npm run deploy:testnet
```

This deploys the tokens, the `OrderBook`, and the `TradingAgent`; mints the agent's inventory; sets its price source + strategy; sends it 5 STT for agent-call gas; and writes the addresses to:
- `deployments/somniaTestnet.json`
- `frontend/src/deployments.json` (so the dashboard auto-finds them)

Copy the printed addresses somewhere handy.

---

## 4. (Optional but recommended) Wire the real LLM agent id

The LLM Inference agent's numeric id isn't in the docs. Get it from the code generator:

1. Open **https://agents.testnet.somnia.network**
2. Select the **LLM Inference** agent → copy its **agent id**.

Then set it on your deployed agent:

```bash
# PowerShell
$env:LLM_AGENT_ID="<the id>"; npm run configure
```
```bash
# Git Bash
LLM_AGENT_ID=<the id> npm run configure
```

Without this, the agent still runs — it just quotes neutrally off the observed price instead of asking the LLM for a skew.

---

## 5. Drive the agent (the live demo) — Terminal A

```bash
npm run orchestrator
```

This fetches a real ETH/USD price every 15s and calls the agent's `applyDecision(price, skew)` on-chain — a moving, two-sided market appears on the book. Leave it running.

> This is the **reliable demo path** (results settle on-chain deterministically). The fully on-chain agent path (`poke()` → JSON agent → LLM agent) and autonomous reactivity are Steps 7–8.

---

## 6. (Optional) Generate fills — Terminal B

```bash
npm run taker
```

A lightweight taker mints itself demo tokens and randomly crosses the spread every ~9s, so you see **trades streaming** (great for the video). Leave it running.

---

## 7. Live dashboard — Terminal C

```bash
cd frontend
npm install        # first time only
npm run dev
```

Open the printed URL (default **http://localhost:5173**). You'll see the live order book, the agent's price/inventory/cycles, and an **agent activity feed** (price observed → decision → quote → fills) with links to the explorer and the receipts site.

---

## 8. Turn on FULL autonomy (the headline feature)

This makes the agent wake itself with **no keeper** via Somnia Reactivity. It needs the agent to hold **≥ 32 STT** (the reactivity owner-balance floor) — the script tops it up to ~33 STT automatically.

```bash
# every 60s
$env:INTERVAL_SECONDS="60"; npm run autonomous     # PowerShell
INTERVAL_SECONDS=60 npm run autonomous             # Git Bash
```

Now the agent re-arms itself each cycle and trades hands-off. You can **stop the orchestrator** (Terminal A) and watch it keep going on its own.

To stop autonomy later, run this one-liner from the root:

```bash
npx hardhat console --network somniaTestnet
# then in the console:
const d = require("./deployments/somniaTestnet.json");
const a = await ethers.getContractAt("TradingAgent", d.agent);
await a.stopAutonomous();
.exit
```

---

## 9. (Optional) Verify the contracts on the explorer

```bash
npx hardhat verify --network somniaTestnet <ORDERBOOK_ADDRESS> <BASE_ADDRESS> <QUOTE_ADDRESS>
```

If the verify plugin needs an explorer API URL, use the **"Verify Contract"** UI at https://shannon-explorer.somnia.network (Blockscout) — compiler **0.8.30**, optimizer **on (200)**, `viaIR` **on**, EVM **cancun**.

---

## 10. Record the demo + publish (submission)

- **Video (2–5 min):** show `npm test` passing → the live dashboard with the agent quoting and fills streaming → turn on autonomy and stop the orchestrator to prove it's hands-off → open an agent receipt to show the AI's reasoning + confidence. Frame it as a teardown ("here's how it works under the hood").
- **GitHub:** initialize is already done. To publish:
  ```bash
  git add -A
  git commit -m "Somnia autonomous market-making agent on an on-chain CLOB"
  gh repo create somnia-agent-clob --public --source=. --push
  ```

---

## Demo modes at a glance

| Mode | Command | What it shows |
|---|---|---|
| **Operator (reliable)** | `npm run orchestrator` | Real price → on-chain `applyDecision` → live quotes. Guaranteed to work. |
| **On-chain agent** | call `agent.poke()` | Full path: JSON agent → LLM agent → quote, via the platform callback. |
| **Autonomous** | `npm run autonomous` | Keeper-free: reactivity re-arms the agent every interval. The headline. |

---

## Troubleshooting

- **`npm test` first run is slow / seems stuck** — `viaIR` compilation takes 1–2 min. Wait it out.
- **Hardhat "Node.js v23 not supported" warning** — harmless. (Switch to Node 20 LTS only if you hit a real error.)
- **CoinGecko rate-limit / no price** — the orchestrator just skips that tick and retries. Or point it at another feed: set `ORCH_PRICE_API` and `ORCH_PRICE_PATH` in `.env`.
- **Dashboard shows "No deployment found"** — run `npm run deploy:testnet` first (it writes `frontend/src/deployments.json`), then refresh.
- **Activity feed is empty but the book updates** — events poll over HTTP every few seconds; give it a moment, or check the orchestrator/taker terminals are running.
- **`poke()` / on-chain agent callback** — the platform struct ABI and the LLM agent id are written to the published spec but should be confirmed on your first live run (watch the agent receipts at https://agents.testnet.somnia.network). The orchestrator path does **not** depend on this and always works for the demo.

---

## What needs live verification (be aware)

1. **LLM Inference agent id** — set it in Step 4 from the explorer.
2. **On-chain callback ABI** — `handleResponse` decodes the platform's `Response[]/Request` structs per the docs; verify on first `poke()` via receipts. The reliable **operator path** (orchestrator) is independent of this.
3. **Reactivity floor** — autonomy needs ≥32 STT parked in the agent (Step 8 handles it).
