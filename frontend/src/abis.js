// Minimal ABIs for the dashboard (reads + events only).

const ORDER_TUPLE = {
  type: "tuple[]",
  components: [
    { name: "id", type: "uint256" },
    { name: "trader", type: "address" },
    { name: "isBuy", type: "bool" },
    { name: "price", type: "uint256" },
    { name: "amount", type: "uint256" },
  ],
};

export const orderBookAbi = [
  { type: "function", name: "getBids", stateMutability: "view", inputs: [], outputs: [ORDER_TUPLE] },
  { type: "function", name: "getAsks", stateMutability: "view", inputs: [], outputs: [ORDER_TUPLE] },
  {
    type: "event",
    name: "Trade",
    inputs: [
      { name: "makerId", type: "uint256", indexed: true },
      { name: "taker", type: "address", indexed: true },
      { name: "maker", type: "address", indexed: true },
      { name: "takerIsBuy", type: "bool", indexed: false },
      { name: "price", type: "uint256", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
];

export const tradingAgentAbi = [
  { type: "function", name: "lastPrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "cycles", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "inventory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
  },
  {
    type: "event",
    name: "Quoted",
    inputs: [
      { name: "bidId", type: "uint256", indexed: false },
      { name: "askId", type: "uint256", indexed: false },
      { name: "bidPrice", type: "uint256", indexed: false },
      { name: "askPrice", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PriceObserved",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "price", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DecisionMade",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "skewBps", type: "int256", indexed: false },
    ],
  },
];
