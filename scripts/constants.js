// Shared constants for scripts. Values from the Somnia Agents docs.
module.exports = {
  // Somnia Agents platform (Shannon testnet)
  PLATFORM_TESTNET: "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776",
  PLATFORM_MAINNET: "0x5E5205CF39E766118C01636bED000A54D93163E6",

  // Base agent ids
  JSON_AGENT_ID: "13174292974160097713",
  PARSE_WEBSITE_AGENT_ID: "12875401142070969085",
  // LLM Inference agent id is NOT published in the docs.
  // Get it from the code generator at https://agents.testnet.somnia.network
  // then set it via LLM_AGENT_ID in your .env (used by configure.js / deploy.js).

  // Default public price source for the on-chain JSON agent path.
  DEFAULT_PRICE_URL: "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
  DEFAULT_PRICE_SELECTOR: "ethereum.usd",
  DEFAULT_PRICE_DECIMALS: 18,
};
