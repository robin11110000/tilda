import React, { useEffect, useMemo, useState } from "react";
import { createPublicClient, http, formatEther } from "viem";
import { RPC_HTTP, EXPLORER, RECEIPTS, ADDR, somniaTestnet } from "./config.js";
import { orderBookAbi, tradingAgentAbi } from "./abis.js";

const fmt = (x, d = 4) =>
  x === undefined || x === null ? "—" : Number(formatEther(x)).toLocaleString(undefined, { maximumFractionDigits: d });
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");

export default function App() {
  const ready = ADDR && ADDR.book;
  const client = useMemo(
    () => (ready ? createPublicClient({ chain: somniaTestnet, transport: http(RPC_HTTP) }) : null),
    [ready]
  );

  const [bids, setBids] = useState([]);
  const [asks, setAsks] = useState([]);
  const [agent, setAgent] = useState({ lastPrice: undefined, cycles: 0n, base: undefined, quote: undefined });
  const [feed, setFeed] = useState([]);

  // poll on-chain state
  useEffect(() => {
    if (!client) return;
    let alive = true;
    async function refresh() {
      try {
        const [b, a, lp, cy, inv] = await Promise.all([
          client.readContract({ address: ADDR.book, abi: orderBookAbi, functionName: "getBids" }),
          client.readContract({ address: ADDR.book, abi: orderBookAbi, functionName: "getAsks" }),
          client.readContract({ address: ADDR.agent, abi: tradingAgentAbi, functionName: "lastPrice" }),
          client.readContract({ address: ADDR.agent, abi: tradingAgentAbi, functionName: "cycles" }),
          client.readContract({ address: ADDR.agent, abi: tradingAgentAbi, functionName: "inventory" }),
        ]);
        if (!alive) return;
        setBids([...b].sort((x, y) => (y.price > x.price ? 1 : -1)));
        setAsks([...a].sort((x, y) => (x.price > y.price ? 1 : -1)));
        setAgent({ lastPrice: lp, cycles: cy, base: inv[0], quote: inv[1] });
      } catch (e) {
        /* transient RPC errors are fine */
      }
    }
    refresh();
    const t = setInterval(refresh, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [client]);

  // poll events for the activity feed
  useEffect(() => {
    if (!client) return;
    const push = (m) => setFeed((f) => [{ ...m, t: Date.now() }, ...f].slice(0, 40));
    const unwatchers = [
      client.watchContractEvent({
        address: ADDR.book,
        abi: orderBookAbi,
        eventName: "Trade",
        onLogs: (logs) =>
          logs.forEach((l) =>
            push({ kind: "Trade", text: `fill ${fmt(l.args.amount, 3)} @ ${fmt(l.args.price)}`, tx: l.transactionHash })
          ),
      }),
      client.watchContractEvent({
        address: ADDR.agent,
        abi: tradingAgentAbi,
        eventName: "Quoted",
        onLogs: (logs) =>
          logs.forEach((l) =>
            push({ kind: "Quote", text: `bid ${fmt(l.args.bidPrice)} / ask ${fmt(l.args.askPrice)}`, tx: l.transactionHash })
          ),
      }),
      client.watchContractEvent({
        address: ADDR.agent,
        abi: tradingAgentAbi,
        eventName: "PriceObserved",
        onLogs: (logs) => logs.forEach((l) => push({ kind: "Price", text: `observed ${fmt(l.args.price)}`, tx: l.transactionHash })),
      }),
      client.watchContractEvent({
        address: ADDR.agent,
        abi: tradingAgentAbi,
        eventName: "DecisionMade",
        onLogs: (logs) => logs.forEach((l) => push({ kind: "Decision", text: `skew ${l.args.skewBps.toString()} bps`, tx: l.transactionHash })),
      }),
    ];
    return () => unwatchers.forEach((u) => { try { u(); } catch {} });
  }, [client]);

  const mid =
    bids[0] && asks[0]
      ? (Number(formatEther(bids[0].price)) + Number(formatEther(asks[0].price))) / 2
      : null;

  if (!ready) {
    return (
      <div className="wrap">
        <h1>🤖 Somnia Autonomous Market-Making Agent</h1>
        <p className="empty">
          No deployment found. From the project root run <code>npm run deploy:testnet</code>, which writes the contract
          addresses into <code>frontend/src/deployments.json</code>, then refresh.
        </p>
      </div>
    );
  }

  return (
    <div className="wrap">
      <header>
        <h1>🤖 Somnia Autonomous Market-Making Agent</h1>
        <div className="sub">An on-chain CLOB quoted by an AI agent on Somnia's Agentic L1</div>
      </header>

      <section className="stats">
        <Stat label="Agent price" value={fmt(agent.lastPrice)} />
        <Stat label="Mid" value={mid ? mid.toFixed(4) : "—"} />
        <Stat label="Cycles" value={agent.cycles?.toString() ?? "0"} />
        <Stat label="Base inv (mSOM)" value={fmt(agent.base, 1)} />
        <Stat label="Quote inv (mUSDC)" value={fmt(agent.quote, 1)} />
      </section>

      <section className="grid">
        <div className="card book">
          <h2>Order book</h2>
          <table>
            <thead>
              <tr><th>Side</th><th>Price</th><th>Size</th><th>Maker</th></tr>
            </thead>
            <tbody>
              {asks.slice(0, 8).reverse().map((o) => (
                <tr key={"a" + o.id} className="ask">
                  <td>ASK</td><td>{fmt(o.price)}</td><td>{fmt(o.amount, 3)}</td><td>{short(o.trader)}</td>
                </tr>
              ))}
              <tr className="midrow"><td colSpan="4">— mid {mid ? mid.toFixed(4) : "—"} —</td></tr>
              {bids.slice(0, 8).map((o) => (
                <tr key={"b" + o.id} className="bid">
                  <td>BID</td><td>{fmt(o.price)}</td><td>{fmt(o.amount, 3)}</td><td>{short(o.trader)}</td>
                </tr>
              ))}
              {bids.length === 0 && asks.length === 0 && (
                <tr><td colSpan="4" className="muted">waiting for the agent to quote…</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card feed">
          <h2>Agent activity</h2>
          <ul>
            {feed.length === 0 && <li className="muted">listening for on-chain events…</li>}
            {feed.map((m, i) => (
              <li key={i} className={"k-" + m.kind}>
                <span className="tag">{m.kind}</span> {m.text}
                {m.tx && (
                  <a href={`${EXPLORER}/tx/${m.tx}`} target="_blank" rel="noreferrer"> tx↗</a>
                )}
              </li>
            ))}
          </ul>
          <a className="receipts" href={RECEIPTS} target="_blank" rel="noreferrer">
            View agent receipts (on-chain proof of reasoning) ↗
          </a>
        </div>
      </section>

      <footer>
        Agent <a href={`${EXPLORER}/address/${ADDR.agent}`} target="_blank" rel="noreferrer">{short(ADDR.agent)}</a>
        {" · "}Book <a href={`${EXPLORER}/address/${ADDR.book}`} target="_blank" rel="noreferrer">{short(ADDR.book)}</a>
        {" · "}Somnia Shannon testnet
      </footer>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}
