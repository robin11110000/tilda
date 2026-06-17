# 🤖 Somnia Autonomous Market-Making Agent

An **autonomous, self-funded AI market-making agent** that lives on an **on-chain Central Limit Order Book (CLOB)**, built on Somnia's **Agentic L1**.

Every cycle the agent:

1. **OBSERVES** a reference price via the Somnia **JSON API agent** (consensus-verified).
2. **REASONS** over price + its own inventory via the Somnia **LLM Inference agent** (deterministic, `temperature=0`, output clamped for safety).
3. **ACTS** by quoting a two-sided bid/ask on its own `OrderBook` CLOB.
4. **RE-ARMS** itself via Somnia **On-Chain Reactivity** (`scheduleSubscriptionAtTimestamp`) so it runs hands-off with **no keeper and no server**.

Every decision is emitted on-chain and backed by a public **agent receipt** (the agent's reasoning + confidence score) — verifiable proof of what the AI decided and why.

> Built for the **Somnia Agentathon**. Sits on Somnia's two flagship narratives at once — the **Agentic L1** and **fully on-chain order books** (dreamDEX), which is explicitly marketed *for autonomous agents*.

---

## Why it fits the judging criteria

| Criterion | How this project delivers |
|---|---|
| **Functionality** | Deployed to Shannon testnet; unit-tested matching engine + agent flow; graceful failure handling (clamped LLM output, `Failed`/`TimedOut` fallback to last price). |
| **Agent-First Design** | The agent *is* the trader — it discovers price (JSON agent), reasons (LLM agent), and acts (places/cancels orders) autonomously through the platform. |
| **Innovation** | Autonomous AI market-maker on a custom on-chain CLOB, driven by deterministic-consensus agents + native reactivity, with receipts as on-chain proof of reasoning. |
| **Autonomous Performance** | Self-funded treasury + self-re-arming reactive schedule = perpetual, keeper-free operation; consensus + confidence thresholds keep it stable. |

## Architecture

```
 Reactivity EpochTick/Schedule (no keeper)
        │  _onEvent (synthetic tx from precompile 0x0100)
        ▼
 TradingAgent.poke ──► createRequest(JSON agent)  ── price ──►  createRequest(LLM agent) ── skew ──►  quote()
        │                                                                                                │
        │                                                                                                ▼
        │                                                                                  OrderBook (CLOB) place/cancel
        ▼                                                                                                │ Fill
   re-arm next cycle                                                                          frontend + receipts (proof)
```

## Contracts

| File | Purpose |
|---|---|
| `contracts/OrderBook.sol` | Minimal on-chain CLOB — maker-price matching, price-time priority, lean for Somnia's gas model. |
| `contracts/TradingAgent.sol` | The AI market maker: agent requests, callback, quoting, reactivity, operator path. |
| `contracts/ISomniaAgents.sol` | Somnia Agents platform interface (per docs). |
| `contracts/MockERC20.sol` | Open-mint demo tokens (base `mSOM` / quote `mUSDC`). |
| `contracts/MockAgentPlatform.sol` | Local stand-in for unit-testing the full observe→decide→act flow. |

## Reusable starter kit — build your own Somnia agent

This repo doubles as a **template for new Somnia builders**. The `contracts/agent-kit/` folder distills the hard parts into a base contract:

| File | Purpose |
|---|---|
| `agent-kit/AgentBase.sol` | Reusable base: agent invocation + deposit funding, the gated `handleResponse` callback, and keeper-free Reactivity self-scheduling. |
| `agent-kit/PriceReactorAgent.sol` | ~30-line example built on `AgentBase` — fetches a number from the JSON agent and stores it on-chain. |
| `MockAgentPlatform.sol` | Lets you **unit-test agent callbacks locally** (the docs give you nothing for this). |

To build your own agent, extend `AgentBase` and implement two hooks:

```solidity
contract MyAgent is AgentBase {
    constructor(ISomniaAgents p, address op) AgentBase(p, op) {}

    function _onCycle() internal override {
        // each autonomous tick: invoke an agent
        _invoke(jsonAgentId, 0.03 ether, abi.encodeWithSignature("fetchUint(string,string,uint8)", url, sel, 18), 1);
    }

    function _onAgentResult(uint256, uint8, AgentResponse[] memory r) internal override {
        // do something with the verified result
    }
}
```

`AgentBase` handles deposits, the callback gate, rebates, and `startAutonomous()` (keeper-free) for you.

## Run it

See **[INSTRUCTIONS.md](INSTRUCTIONS.md)** for the full step-by-step (tests → deploy → drive → dashboard → full autonomy).

```bash
npm install
cp .env.example .env        # add your testnet PRIVATE_KEY
npm test                    # contracts + agent flow
npm run deploy:testnet      # deploy to Somnia Shannon
npm run orchestrator        # drive the agent (live demo)
cd frontend && npm install && npm run dev   # live dashboard
```

## Network

Somnia Shannon testnet · Chain ID `50312` · RPC `https://api.infra.testnet.somnia.network/` · Agents platform `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776`.
