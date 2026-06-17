import deployments from "./deployments.json";

export const RPC_HTTP = "https://api.infra.testnet.somnia.network/";
export const RPC_WS = "wss://api.infra.testnet.somnia.network/ws";
export const EXPLORER = "https://shannon-explorer.somnia.network";
export const RECEIPTS = "https://agents.testnet.somnia.network";

export const ADDR = deployments; // { base, quote, book, agent, ... } written by scripts/deploy.js

export const somniaTestnet = {
  id: 50312,
  name: "Somnia Shannon",
  nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
  rpcUrls: { default: { http: [RPC_HTTP], webSocket: [RPC_WS] } },
  blockExplorers: { default: { name: "Shannon", url: EXPLORER } },
};
