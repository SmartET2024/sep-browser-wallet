import axios from "axios";
import memoize from "mem";
import ExpiryMap from "expiry-map";
import BigNumber from "bignumber.js";
import { getAddress, isAddress } from "ethers";
import { withOfflineCache } from "lib/ext/offlineCache";

import { indexerApi } from "./indexer";

export type DexTokenPrice = {
  usd: number;
  usd_24h_change?: number;
  usd_reserve?: string;
};
export type DexPrices = Record<string, DexTokenPrice>;

const THREE_MIN = 3 * 60_000;
const ONE_HOUR = 60 * 60_000;
const ONE_DAY = 24 * 60 * 60_000;
const ADDITIONAL_PLATFORM_COINS = new Map([[800001, "octaspace"]]);

export const coinGeckoApi = axios.create({
  baseURL: "https://api.coingecko.com/api/v3",
  timeout: 90_000,
});

export const coinGeckoTerminalApi = axios.create({
  baseURL: "https://api.geckoterminal.com/api/v2",
  timeout: 90_000,
});

export const dexScreenerApi = axios.create({
  baseURL: "https://api.dexscreener.com/latest",
  timeout: 90_000,
});

// Increase cache duration to reduce API calls
const CACHE_DURATION = 10 * 60_000; // 10 minutes
const tokenPricesCache = new ExpiryMap<string, DexTokenPrice>(CACHE_DURATION);

// Track request timestamps to implement rate limiting
const lastRequestTime = { timestamp: 0 };
const MIN_REQUEST_INTERVAL = 6100; // Minimum ~6 seconds between requests (10 per minute)

interface CoinGeckoPriceResponse {
  usd: number;
  usd_24h_change?: number;
}

/**
 * Rate-limited API call to CoinGecko
 * Ensures we don't exceed rate limits
 */
async function rateLimitedCoinGeckoRequest<T>(
  endpoint: string,
  params: Record<string, any> = {},
): Promise<T | null> {
  try {
    // Implement rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime.timestamp;

    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
      // Wait for rate limit
      await new Promise((resolve) =>
        setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest),
      );
    }

    // Update timestamp before request
    lastRequestTime.timestamp = Date.now();

    // Make the request
    const response = await coinGeckoApi.get<T>(endpoint, { params });
    return response.data;
  } catch (error) {
    console.error(`Error in CoinGecko request to ${endpoint}:`, error);
    return null;
  }
}

export async function getDexPrices(tokenAddresses: string[], chainId?: number) {
  try {
    if (tokenAddresses.length === 0) return {};
    if (tokenAddresses.length > 1000) return {}; // Too much

    const allCoinIds = await getCoinGeckoCoinIds();
    const data: Record<string, DexTokenPrice> = {};
    const tokensToRefresh: { tokenAddress: string; coinId: string }[] = [];
    const coinsToRefreshSet = new Set<string>();
    const missedAddresses = new Set<string>();

    for (const tokenAddress of tokenAddresses) {
      const coinIdsByChain = allCoinIds[tokenAddress.toLowerCase()];
      const coinId = coinIdsByChain
        ? chainId
          ? coinIdsByChain[chainId]
          : Object.values(coinIdsByChain)[0]
        : undefined;
      const cached = tokenPricesCache.get(
        coinId ?? `${chainId ?? ""}_${tokenAddress}`,
      );

      if (cached) {
        data[tokenAddress] = cached;
        continue;
      }

      if (coinId) {
        tokensToRefresh.push({ tokenAddress, coinId });
        coinsToRefreshSet.add(coinId);
      } else {
        missedAddresses.add(tokenAddress);
      }
    }

    // Coin gecko - simple
    if (coinsToRefreshSet.size > 0) {
      const freshCoinPrices: Record<string, DexTokenPrice> = {};
      const coinsToRefresh = Array.from(coinsToRefreshSet);

      // Process in smaller batches to reduce rate limiting issues
      const BATCH_SIZE = 30;

      while (coinsToRefresh.length > 0) {
        const nextCoins = coinsToRefresh.splice(0, BATCH_SIZE);

        const response = await rateLimitedCoinGeckoRequest<
          Record<string, CoinGeckoPriceResponse>
        >("/simple/price", {
          ids: nextCoins.join(),
          vs_currencies: "usd",
          include_24h_change: true,
        });

        if (!response) continue;

        // Transform the response to match our DexTokenPrice format
        for (const [coinId, priceData] of Object.entries(response)) {
          freshCoinPrices[coinId] = {
            usd: priceData.usd,
            usd_24h_change: priceData.usd_24h_change,
          };
        }
      }

      // Cache new prices
      for (const [coinId, price] of Object.entries(freshCoinPrices)) {
        tokenPricesCache.set(coinId, price);
      }

      // Update data to return
      for (const { tokenAddress, coinId } of tokensToRefresh) {
        const prices = freshCoinPrices[coinId];
        if (prices) data[tokenAddress] = prices;
      }
    }

    // Dex screener
    if (missedAddresses.size > 0 && missedAddresses.size <= 500) {
      const addressesToRefresh = Array.from(missedAddresses);

      try {
        while (addressesToRefresh.length > 0) {
          const nextAddresses = addressesToRefresh.splice(0, 30);

          const res = await dexScreenerApi
            .get(`/dex/tokens/${nextAddresses.join()}`)
            .catch(() => null);

          const dsPairs = res?.data?.pairs;
          if (!dsPairs) continue;

          for (const pair of dsPairs) {
            const reserveBN = new BigNumber(pair.liquidity?.usd);

            if (reserveBN.isNaN() || reserveBN.isLessThan(100)) {
              continue;
            } else {
              const baseBN = new BigNumber(pair.liquidity.base);
              const quoteBN = new BigNumber(pair.liquidity.quote);

              if (baseBN.isLessThan(0.01) || quoteBN.isLessThan(0.01)) {
                continue;
              }
            }

            const tokenAddress = getAddress(pair.baseToken?.address);
            const existing = data[tokenAddress];

            if (
              existing?.usd_reserve &&
              new BigNumber(existing.usd_reserve).isGreaterThan(reserveBN)
            ) {
              continue;
            }

            const usdPrice = new BigNumber(pair.priceUsd).toNumber();
            if (!usdPrice) continue;

            const usdPriceChange =
              new BigNumber(pair.priceChange?.h24).toNumber() || undefined;

            const price: DexTokenPrice = {
              usd: usdPrice,
              usd_24h_change: usdPriceChange,
              usd_reserve: reserveBN.toString(),
            };

            data[tokenAddress] = price;
            tokenPricesCache.set(`${chainId ?? ""}_${tokenAddress}`, price);
          }
        }
      } catch (err) {
        console.error(err);
      }
    }

    return data;
  } catch (err) {
    console.error("Error in getDexPrices:", err);
    return {};
  }
}

// Dynamic mappings for platforms to chain IDs and vice versa
let platformToChainId: Record<string, number> = {};
let chainIdToPlatform: Record<number, string> = {};
let nativeTokenIds: Record<number, string> = {};

// Update knownPlatforms with an even more comprehensive list of networks
const knownPlatforms: Record<string, number> = {
  // Ethereum and L2s
  ethereum: 1,
  "ethereum-mainnet": 1, // Alternative name
  "eth-mainnet": 1, // Alternative name
  "arbitrum-one": 42161,
  arbitrum: 42161, // Alternative name
  "arbitrum-nova": 42170,
  optimistic: 10,
  optimism: 10, // Alternative name
  "optimism-ethereum": 10, // Alternative name
  "op-mainnet": 10, // Alternative name
  base: 8453,
  "base-mainnet": 8453, // Alternative name
  zksync: 324,
  "zksync-era": 324, // Alternative name
  "zksync-lite": 1101, // zksync lite
  scroll: 534352,
  "scroll-mainnet": 534352, // Alternative name
  "polygon-zkevm": 1101,
  "polygon-zk": 1101, // Alternative name
  zkevm: 1101, // Alternative name
  linea: 59144,
  "linea-mainnet": 59144, // Alternative name
  "metis-andromeda": 1088,
  metis: 1088, // Alternative name
  "boba-network": 288,
  boba: 288, // Alternative name
  "boba-ethereum": 288, // Alternative name
  loopring: 1,
  starknet: 9001,

  // Major L1s
  "binance-smart-chain": 56,
  bsc: 56, // Alternative name
  bnb: 56, // Alternative name
  "bnb-chain": 56, // Alternative name
  "binance-chain": 56, // Alternative name
  polygon: 137,
  "polygon-pos": 137, // Alternative name
  "polygon-mainnet": 137, // Alternative name
  avalanche: 43114,
  "avalanche-c-chain": 43114, // Alternative name
  avax: 43114, // Alternative name
  "avalanche-c": 43114, // Alternative name
  fantom: 250,
  "fantom-opera": 250, // Alternative name
  ftm: 250, // Alternative name
  cronos: 25,
  "cronos-mainnet": 25, // Alternative name
  "crypto-com": 25, // Alternative name

  // Mid-size EVM chains
  moonbeam: 1284,
  "moonbeam-mainnet": 1284, // Alternative name
  glmr: 1284, // Alternative name
  moonriver: 1285,
  "moonriver-mainnet": 1285, // Alternative name
  movr: 1285, // Alternative name
  klaytn: 8217,
  "klaytn-mainnet": 8217, // Alternative name
  klay: 8217, // Alternative name
  celo: 42220,
  "celo-mainnet": 42220, // Alternative name
  "harmony-shard-0": 1666600000,
  harmony: 1666600000, // Alternative name
  "harmony-mainnet": 1666600000, // Alternative name
  one: 1666600000, // Alternative name
  xdai: 100,
  gnosis: 100, // Alternative name
  "gnosis-chain": 100, // Alternative name
  "xdai-chain": 100, // Alternative name
  "dai-chain": 100, // Alternative name
  aurora: 1313161554,
  "aurora-near": 1313161554, // Alternative name
  "near-aurora": 1313161554, // Alternative name
  kava: 2222,
  "kava-evm": 2222, // Alternative name
  "kava-mainnet": 2222, // Alternative name
  syscoin: 57,
  "syscoin-nevm": 57, // Alternative name
  "syscoin-mainnet": 57, // Alternative name
  fuse: 122,
  "fuse-mainnet": 122, // Alternative name
  "fuse-network": 122, // Alternative name
  heco: 128,
  "huobi-token": 128, // Alternative name
  "huobi-eco-chain": 128, // Alternative name
  huobi: 128, // Alternative name
  evmos: 9001,
  "evmos-mainnet": 9001, // Alternative name
  telos: 40,
  "telos-evm": 40, // Alternative name
  "telos-mainnet": 40, // Alternative name

  // Newer EVM chains
  mantle: 5000,
  "mantle-network": 5000, // Alternative name
  "mantle-mainnet": 5000, // Alternative name
  zetachain: 7000,
  zeta: 7000, // Alternative name
  "zeta-mainnet": 7000, // Alternative name
  manta: 169,
  "manta-pacific": 169, // Alternative name
  blast: 81457,
  "blast-mainnet": 81457, // Alternative name
  filecoin: 314,
  "filecoin-mainnet": 314, // Alternative name
  "filecoin-evm": 314, // Alternative name
  fevm: 314, // Alternative name
  canto: 7700,
  "canto-mainnet": 7700, // Alternative name
  conflux: 1030,
  "conflux-espace": 1030, // Alternative name
  "cfx-espace": 1030, // Alternative name
  astar: 592,
  "astar-network": 592, // Alternative name
  "astar-mainnet": 592, // Alternative name
  shiden: 336,
  "shiden-network": 336, // Alternative name
  "shiden-mainnet": 336, // Alternative name
  "oasis-emerald": 42262,
  oasis: 42262, // Alternative name
  emerald: 42262, // Alternative name
  "step-network": 1234,
  step: 1234, // Alternative name

  // Gaming/App-specific chains
  dogechain: 2000,
  "doge-chain": 2000, // Alternative name
  ronin: 2020,
  "ronin-mainnet": 2020, // Alternative name
  axie: 2020, // Alternative name
  "axie-infinity": 2020, // Alternative name
  "immutable-x": 1400,
  immutable: 1400, // Alternative name
  imx: 1400, // Alternative name
  enjin: 2019,
  "enjin-mainnet": 2019, // Alternative name
  enj: 2019, // Alternative name
  "gala-chain": 20765,
  gala: 20765, // Alternative name
  wax: 14155,
  "wax-mainnet": 14155, // Alternative name
  velas: 106,
  "velas-evm": 106, // Alternative name
  "velas-mainnet": 106, // Alternative name

  // Bitcoin related
  smartbch: 10000,
  "smart-bitcoin-cash": 10000, // Alternative name
  "bch-smart-chain": 10000, // Alternative name
  "bch-chain": 10000, // Alternative name
  rsk: 30,
  rootstock: 30, // Alternative name
  "rsk-mainnet": 30, // Alternative name
  stacks: 1559,
  "stacks-mainnet": 1559, // Alternative name
  stx: 1559, // Alternative name

  // Other Important EVM Chains
  elastos: 20,
  "elastos-smart-chain": 20, // Alternative name
  "elastos-mainnet": 20, // Alternative name
  pulsechain: 369,
  "pulse-chain": 369, // Alternative name
  pulse: 369, // Alternative name
  "core-blockchain": 1116,
  core: 1116, // Alternative name
  "core-mainnet": 1116, // Alternative name
  "op-bnb": 204,
  "op-bnb-chain": 204, // Alternative name
  "optimism-on-bnb": 204, // Alternative name
  "bnb-opchain": 204, // Alternative name
  "ethereum-classic": 61,
  "eth-classic": 61, // Alternative name
  classic: 61, // Alternative name
  etc: 61, // Alternative name
  okc: 66,
  okx: 66, // Alternative name
  "okex-chain": 66, // Alternative name
  "okx-chain": 66, // Alternative name
  meter: 82,
  "meter-mainnet": 82, // Alternative name
  callisto: 820,
  "callisto-mainnet": 820, // Alternative name
  clo: 820, // Alternative name

  // New and Emerging EVM Chains
  mode: 34443,
  "mode-network": 34443, // Alternative name
  pom: 771,
  "pom-mainnet": 771, // PlatON OpenMarket
  taraxa: 841,
  "taraxa-mainnet": 841, // Alternative name
  ultron: 1231,
  "ultron-mainnet": 1231, // Alternative name
  tombchain: 6969,
  "tomb-chain": 6969, // Alternative name
  tiltyard: 710420,
  "tiltyard-subnet": 710420, // Alternative name
  hedera: 295,
  "hedera-mainnet": 295, // Alternative name
  bittorrent: 199,
  btt: 199, // BitTorrent Chain
  bttc: 199, // Alternative name
  kcc: 321,
  "kucoin-community-chain": 321, // Alternative name
  "kcc-mainnet": 321, // Alternative name
  wemix: 1111,
  "wemix-mainnet": 1111, // Alternative name

  // Cosmos Ecosystem
  cosmos: 118,
  "cosmos-hub": 118, // Alternative name
  osmosis: 118, // Using Cosmos Hub chainID
  "osmosis-zone": 118, // Alternative name
  juno: 118, // Using Cosmos Hub chainID
  "juno-network": 118, // Alternative name
  "terra-classic": 118, // Using Cosmos Hub chainID
  "luna-classic": 118, // Alternative name
  terra: 118, // Terra 2.0, using Cosmos Hub chainID
  luna: 118, // Alternative name
  "secret-network": 118, // Using Cosmos Hub chainID
  secret: 118, // Alternative name
  akash: 118, // Using Cosmos Hub chainID
  "akash-network": 118, // Alternative name
  kujira: 321,
  "kujira-network": 321, // Alternative name

  // Other Non-EVM Chains
  near: 1313161554, // Using Aurora chainID for NEAR
  "near-protocol": 1313161554, // Alternative name
  sui: 11, // Not EVM but important
  "sui-network": 11, // Alternative name
  aptos: 12, // Not EVM but important
  "aptos-network": 12, // Alternative name
  solana: 13, // Not EVM but important
  "solana-network": 13, // Alternative name
  "flow-blockchain": 14, // Not EVM but important
  flow: 14, // Alternative name
  algorand: 15, // Not EVM but important
  "algorand-network": 15, // Alternative name
  ripple: 16, // XRP Ledger, not EVM but important
  "xrp-ledger": 16, // Alternative name
  xrpl: 16, // Alternative name
  cardano: 17, // Not EVM but important
  "cardano-network": 17, // Alternative name
  ada: 17, // Alternative name
  polkadot: 18, // Not EVM but important
  "polkadot-network": 18, // Alternative name
  dot: 18, // Alternative name

  // Flare ecosystem
  flare: 14,
  "flare-network": 14, // Alternative name
  "flare-mainnet": 14, // Alternative name
  songbird: 19,
  "songbird-network": 19, // Alternative name
  "songbird-canary": 19, // Alternative name

  // IoT Blockchains
  iotex: 4689,
  "iotex-network": 4689, // Alternative name
  "iotex-mainnet": 4689, // Alternative name
  iota: 10001, // Not EVM but important
  "iota-network": 10001, // Alternative name
  shimmer: 10002, // Not EVM but important
  "shimmer-network": 10002, // Alternative name

  // Finance-specific chains
  stellar: 20001, // Not EVM but important
  "stellar-network": 20001, // Alternative name
  xlm: 20001, // Alternative name
  tron: 20002, // Not standard EVM
  "tron-network": 20002, // Alternative name
  trx: 20002, // Alternative name

  // Your networks
  "smart-energy-chain": 19516,
  "smart-energy-testnet": 19515,
  "smart-energy-mainnet": 19516, // Alternative name
  "sep-chain": 19516, // Alternative name
  "sep-mainnet": 19516, // Alternative name
  "sep-testnet": 19515, // Alternative name
};

// Update knownNativeTokens with an even more comprehensive mapping
const knownNativeTokens: Record<number, string> = {
  // Ethereum and L2s
  1: "ethereum", // Ethereum
  42161: "ethereum", // Arbitrum
  42170: "ethereum", // Arbitrum Nova
  10: "ethereum", // Optimism
  8453: "ethereum", // Base
  324: "ethereum", // zkSync Era
  1101: "ethereum", // zkSync Lite / Polygon zkEVM
  534352: "ethereum", // Scroll
  59144: "ethereum", // Linea
  1088: "metis-token", // Metis
  288: "ethereum", // Boba Network

  // Major L1s
  56: "binancecoin", // BNB Chain
  137: "matic-network", // Polygon
  43114: "avalanche-2", // Avalanche
  250: "fantom", // Fantom
  25: "crypto-com-chain", // Cronos

  // Mid-size EVM chains
  1284: "moonbeam", // Moonbeam
  1285: "moonriver", // Moonriver
  8217: "klay-token", // Klaytn
  42220: "celo", // Celo
  1666600000: "harmony", // Harmony
  100: "xdai", // Gnosis Chain
  1313161554: "ethereum", // Aurora (uses ETH)
  2222: "kava", // Kava
  57: "syscoin", // Syscoin
  122: "fuse-network-token", // Fuse
  128: "huobi-token", // HECO
  9001: "evmos", // Evmos
  40: "telos", // Telos

  // Newer EVM chains
  5000: "mantle", // Mantle
  7000: "zetachain", // ZetaChain
  169: "ethereum", // Manta Pacific (uses ETH)
  81457: "ethereum", // Blast (uses ETH)
  314: "filecoin", // Filecoin
  7700: "canto", // Canto
  1030: "conflux-token", // Conflux
  592: "astar", // Astar
  336: "shiden", // Shiden
  42262: "oasis-network", // Oasis
  1234: "step-network-token", // Step Network

  // Gaming/App-specific chains
  2000: "dogecoin", // Dogechain
  2020: "ronin", // Ronin
  1400: "immutable-x", // Immutable X
  2019: "enjincoin", // Enjin
  20765: "gala", // Gala
  14155: "wax", // WAX
  106: "velas", // Velas

  // Bitcoin related
  10000: "bitcoin-cash", // SmartBCH
  30: "rootstock", // RSK
  1559: "stacks", // Stacks

  // Other Important EVM Chains
  20: "elastos", // Elastos
  369: "pulsechain", // PulseChain
  1116: "coredao", // CORE
  204: "binancecoin", // opBNB (uses BNB)
  61: "ethereum-classic", // Ethereum Classic
  66: "oec-token", // OKX Chain
  82: "meter", // Meter
  820: "callisto", // Callisto

  // New and Emerging EVM Chains
  34443: "mode", // Mode
  771: "pom", // PlatON OpenMarket
  841: "taraxa", // Taraxa
  1231: "ultron", // Ultron
  6969: "tomb-token", // Tomb Chain
  710420: "tiltyard", // Tiltyard
  295: "hedera-hashgraph", // Hedera
  199: "bittorrent", // BitTorrent Chain
  321: "kucoin-shares", // KuCoin Community Chain
  1111: "wemix-token", // Wemix

  // Cosmos Ecosystem
  118: "cosmos", // Cosmos Hub
  // All cosmos tokens use the same chain ID reference (118) but different coin IDs

  // Other Non-EVM Chains
  11: "sui", // Sui
  12: "aptos", // Aptos
  13: "solana", // Solana
  14: "flow", // Flow
  15: "algorand", // Algorand
  16: "ripple", // XRP
  17: "cardano", // Cardano
  18: "polkadot", // Polkadot

  // Flare ecosystem
  19: "songbird", // Songbird

  // IoT Blockchains
  4689: "iotex", // IoTeX
  10001: "iota", // IOTA
  10002: "shimmer", // Shimmer

  // Finance-specific chains
  20001: "stellar", // Stellar
  20002: "tron", // TRON

  // Your tokens
  19516: "smart-energy-pay", // Smart Energy Chain
  19515: "smart-energy-pay", // Smart Energy Testnet
};

// Flag to track if dynamic mappings have been initialized
let mappingsInitialized = false;

/**
 * Initialize platform mappings from CoinGecko
 * This automatically builds mappings from platform IDs to chain IDs and native tokens
 */
export const initializePlatformMappings = memoize(
  async () => {
    if (mappingsInitialized) {
      return;
    }

    console.log("Initializing platform mappings from CoinGecko...");

    // Start with known platforms
    platformToChainId = { ...knownPlatforms };

    // Create reverse mapping for known platforms
    for (const [platform, chainId] of Object.entries(platformToChainId)) {
      chainIdToPlatform[chainId] = platform;
    }

    // Initialize native tokens with known values
    nativeTokenIds = { ...knownNativeTokens };

    try {
      // Fetch all asset platforms from CoinGecko
      const { data: platforms } = await coinGeckoApi.get("/asset_platforms");

      // Extract chain IDs and platform relationships
      for (const platform of platforms) {
        if (
          platform.id &&
          platform.chain_identifier &&
          typeof platform.chain_identifier === "number"
        ) {
          platformToChainId[platform.id] = platform.chain_identifier;
          chainIdToPlatform[platform.chain_identifier] = platform.id;

          // If the platform has a native coin ID, store it
          if (platform.native_coin_id) {
            nativeTokenIds[platform.chain_identifier] = platform.native_coin_id;
          }
        }
      }

      console.log(
        `Mapped ${Object.keys(platformToChainId).length} platforms to chain IDs`,
      );
      console.log(
        `Found ${Object.keys(nativeTokenIds).length} native token mappings`,
      );

      // Now try to discover additional native token mappings by checking coins list
      const allTokens = await getAllCoinGeckoTokens();

      // For chains that don't have native token mappings yet, try to find them
      for (const chainId of Object.keys(chainIdToPlatform).map(Number)) {
        if (!nativeTokenIds[chainId]) {
          const platform = chainIdToPlatform[chainId];

          // Find tokens that might be native to this platform
          const potentialNativeTokens = allTokens.filter((token) => {
            if (!token.platforms) return false;

            // Look for tokens with empty, 0x0, or null addresses on this platform
            const address = token.platforms[platform];
            return (
              address === "" ||
              address === "0x0" ||
              address === "0x0000000000000000000000000000000000000000" ||
              !address
            );
          });

          if (potentialNativeTokens.length > 0) {
            // Prioritize tokens with "native" or "coin" in their name or platform name
            const nativeToken =
              potentialNativeTokens.find(
                (token) =>
                  token.name.toLowerCase().includes("native") ||
                  token.name.toLowerCase().includes("coin") ||
                  token.name.toLowerCase().includes(platform),
              ) || potentialNativeTokens[0];

            nativeTokenIds[chainId] = nativeToken.id;
            console.log(
              `Discovered native token for chain ${chainId}: ${nativeToken.id}`,
            );
          }
        }
      }

      mappingsInitialized = true;
    } catch (err) {
      console.error("Failed to initialize platform mappings:", err);

      // Fall back to known mappings if API fails
      platformToChainId = { ...knownPlatforms };
      for (const [platform, chainId] of Object.entries(platformToChainId)) {
        chainIdToPlatform[chainId] = platform;
      }
      nativeTokenIds = { ...knownNativeTokens };

      mappingsInitialized = true;
    }
  },
  {
    maxAge: ONE_HOUR * 12, // Cache for 12 hours
  },
);

// Updated function to get platform from chain ID using dynamic mapping
function getPlatformFromChainId(chainId: number): string | null {
  // Ensure mappings are initialized
  if (!mappingsInitialized) {
    // Return known mapping if available
    if (knownPlatforms && Object.values(knownPlatforms).includes(chainId)) {
      for (const [platform, id] of Object.entries(knownPlatforms)) {
        if (id === chainId) return platform;
      }
    }
  }

  return chainIdToPlatform[chainId] || null;
}

// Updated function to get chain ID from platform using dynamic mapping
function getChainIdFromPlatform(platform: string): number | null {
  // Ensure mappings are initialized
  if (!mappingsInitialized) {
    // Return known mapping if available
    return knownPlatforms[platform] || null;
  }

  return platformToChainId[platform] || null;
}

/**
 * Gets the native token ID for a chain
 */
function getNativeTokenId(chainId: number): string | null {
  return nativeTokenIds[chainId] || null;
}

// Update getCoinGeckoNativeTokenPrice to use rate-limited API
export const getCoinGeckoNativeTokenPrice = async (chainId: number) => {
  try {
    console.log(`Getting native token price for chain ID ${chainId}`);

    // Use cache key for better caching
    const cacheKey = `native_price_${chainId}`;
    const cached = tokenPricesCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Ensure mappings are initialized
    await initializePlatformMappings();

    // Get native token ID from our mapping
    const nativeCoinId = getNativeTokenId(chainId);
    if (nativeCoinId) {
      console.log(
        `Using mapped native token for chain ${chainId}: ${nativeCoinId}`,
      );

      // Special handling for Smart Energy Pay
      if (chainId === 19516 || chainId === 19515) {
        console.log(`Special handling for Smart Energy Pay chain: ${chainId}`);

        const response = await rateLimitedCoinGeckoRequest<
          Record<string, CoinGeckoPriceResponse>
        >("/simple/price", {
          ids: "smart-energy-pay",
          vs_currencies: "usd",
          include_24h_change: true,
        });

        if (response?.["smart-energy-pay"]) {
          console.log(
            "Smart Energy Pay CoinGecko response:",
            JSON.stringify(response),
          );

          const price = {
            usd: response["smart-energy-pay"].usd,
            usd_24h_change: response["smart-energy-pay"].usd_24h_change,
          };

          // Cache the result
          tokenPricesCache.set(cacheKey, price);

          return price;
        }
      }

      // For other tokens
      const response = await rateLimitedCoinGeckoRequest<
        Record<string, CoinGeckoPriceResponse>
      >("/simple/price", {
        ids: nativeCoinId,
        vs_currencies: "usd",
        include_24h_change: true,
      });

      if (response?.[nativeCoinId]) {
        console.log(
          `CoinGecko response for ${nativeCoinId}:`,
          JSON.stringify(response),
        );

        const price = {
          usd: response[nativeCoinId].usd,
          usd_24h_change: response[nativeCoinId].usd_24h_change,
        };

        // Cache the result
        tokenPricesCache.set(cacheKey, price);

        return price;
      }
    }

    // Try to find platform
    const platform = getPlatformFromChainId(chainId);
    console.log(`Platform for chain ID ${chainId}: ${platform || "not found"}`);

    // Additional platform-based lookup
    if (platform) {
      try {
        const allTokens = await getAllCoinGeckoTokens();

        // Find potential native coins for this platform
        for (const token of allTokens) {
          if (token.platforms && platform in token.platforms) {
            // If token address is 0x0 or similar, it's likely the native coin
            const address = token.platforms[platform];
            if (
              address === "0x0" ||
              address === "0x0000000000000000000000000000000000000000" ||
              !address
            ) {
              console.log(
                `Found potential native coin for ${platform}: ${token.id}`,
              );

              // Save this mapping for future use
              nativeTokenIds[chainId] = token.id;

              const response = await rateLimitedCoinGeckoRequest<
                Record<string, CoinGeckoPriceResponse>
              >("/simple/price", {
                ids: token.id,
                vs_currencies: "usd",
                include_24h_change: true,
              });

              if (response?.[token.id]) {
                const price = {
                  usd: response[token.id].usd,
                  usd_24h_change: response[token.id].usd_24h_change,
                };

                // Cache the result
                tokenPricesCache.set(cacheKey, price);

                return price;
              }
            }
          }
        }
      } catch (err) {
        console.error("Error searching for native coin:", err);
      }
    }

    // Fall back to additional platform coins
    const additionalCoinId = ADDITIONAL_PLATFORM_COINS.get(chainId);
    if (additionalCoinId) {
      console.log(
        `Using additional mapping for chain ID ${chainId}: ${additionalCoinId}`,
      );

      const response = await rateLimitedCoinGeckoRequest<
        Record<string, CoinGeckoPriceResponse>
      >("/simple/price", {
        ids: additionalCoinId,
        vs_currencies: "usd",
        include_24h_change: true,
      });

      if (response?.[additionalCoinId]) {
        const price = {
          usd: response[additionalCoinId].usd,
          usd_24h_change: response[additionalCoinId].usd_24h_change,
        };

        // Cache the result
        tokenPricesCache.set(cacheKey, price);

        return price;
      }
    }

    console.warn(
      `No native coin ID found for chain ID ${chainId} after all attempts`,
    );
    return null;
  } catch (err) {
    console.error("Error in getCoinGeckoNativeTokenPrice:", err);
    return null;
  }
};

export const getCoinGeckoPlatformPrices = memoize(
  async () => {
    const { platformIds } = await getCoinGeckoPlatformIds();

    const { data } = await indexerApi.get<DexPrices>("/cg/simple/price", {
      params: {
        ids: Object.values(platformIds)
          .map((p) => p.native_coin_id)
          .concat(Array.from(ADDITIONAL_PLATFORM_COINS.values()))
          .join(),
        vs_currencies: "USD",
        include_24hr_change: true,
      },
    });

    return data;
  },
  {
    maxAge: THREE_MIN, // 3 min
  },
);

export const getCoinGeckoCoinIds = withOfflineCache(
  async () => {
    const { data } = await coinGeckoApi.get("/coins/list", {
      params: { include_platform: true },
    });
    const { platformIds } = await getCoinGeckoPlatformIds();

    const allCoinIds: Record<string, Record<number, string>> = {};

    for (const item of data) {
      for (const [platformId, tokenAddress] of Object.entries(item.platforms)) {
        try {
          const chainId = platformIds[platformId]?.chain_id;
          if (!chainId) continue;

          if (isAddress(tokenAddress)) {
            allCoinIds[tokenAddress] = {
              ...(allCoinIds[tokenAddress] ?? {}),
              [chainId]: item.id,
            };
          }
        } catch {}
      }
    }

    return allCoinIds;
  },
  {
    key: "cg_coins_list",
    hotMaxAge: 5_000,
    coldMaxAge: ONE_DAY,
  },
);

export const getCoinGeckoTerminalNetworkIds = withOfflineCache(
  async () => {
    const { platformIds } = await getCoinGeckoPlatformIds();

    const cgtNetworkIds: Record<number, string> = {};

    let page = 1;
    while (true) {
      const { data } = await coinGeckoTerminalApi.get("/networks", {
        params: { page },
      });

      for (const item of data.data) {
        const cgPlatformId = item.attributes.coingecko_asset_platform_id;
        if (!cgPlatformId) continue;

        const chainId = platformIds[cgPlatformId].chain_id;
        if (!chainId) continue;

        cgtNetworkIds[chainId] = item.id;
      }

      if (!data.links.next || page > 4) break;
      page++;
    }

    return cgtNetworkIds;
  },
  {
    key: "cgt_networks",
    hotMaxAge: 5_000,
    coldMaxAge: ONE_DAY,
  },
);

export const getCoinGeckoPlatformIds = withOfflineCache(
  async () => {
    const { data } = await coinGeckoApi.get("/coins/list", {
      params: { include_platform: true },
    });

    const platformIds: Record<
      string,
      { chain_id: number; native_coin_id: string }
    > = {};
    const chainIds: Record<number, string> = {};

    for (const item of data) {
      if (item.platforms) {
        for (const [platform, address] of Object.entries(item.platforms)) {
          if (isAddress(address)) {
            const chainId = getChainIdFromPlatform(platform);
            if (chainId) {
              platformIds[platform] = {
                chain_id: chainId,
                native_coin_id: item.id,
              };
              chainIds[chainId] = platform;
            }
          }
        }
      }
    }

    return { platformIds, chainIds };
  },
  {
    key: "cg_platform_ids",
    hotMaxAge: 5_000,
    coldMaxAge: ONE_DAY,
  },
);

// Cache for storing all available tokens
interface CoinGeckoToken {
  id: string;
  symbol: string;
  name: string;
  platforms: Record<string, string>;
}

interface CoinGeckoMarketItem {
  id: string;
  symbol: string;
  name: string;
  market_cap: number;
  current_price: number;
  price_change_percentage_24h: number;
}

interface TokenWithAddress {
  id: string;
  symbol: string;
  name: string;
  address: string;
}

interface PopularToken extends TokenWithAddress {
  market_cap: number;
  current_price: number;
  price_change_percentage_24h: number;
}

const allTokensCache = new ExpiryMap<string, CoinGeckoToken[]>(ONE_HOUR);

/**
 * Fetches and caches all available tokens from CoinGecko
 * This includes their supported platforms/networks
 */
export const getAllCoinGeckoTokens = memoize(
  async (): Promise<CoinGeckoToken[]> => {
    console.log("Fetching all tokens from CoinGecko...");

    // Check cache first
    const cachedTokens = allTokensCache.get("all_tokens");
    if (cachedTokens) {
      console.log(`Returning ${cachedTokens.length} tokens from cache`);
      return cachedTokens;
    }

    try {
      const { data } = await coinGeckoApi.get("/coins/list", {
        params: { include_platform: true },
      });

      console.log(`Fetched ${data.length} tokens from CoinGecko`);

      // Cache the results
      allTokensCache.set("all_tokens", data);

      return data;
    } catch (err) {
      console.error("Failed to fetch all tokens:", err);
      return [];
    }
  },
  {
    maxAge: ONE_HOUR, // Cache for 1 hour
  },
);

/**
 * Fetches tokens available on a specific network/chain
 * @param chainId The chain ID to get tokens for
 * @returns List of tokens available on the specified chain
 */
export const getTokensForChain = async (
  chainId: number,
): Promise<TokenWithAddress[]> => {
  // Ensure mappings are initialized first
  await initializePlatformMappings();

  try {
    const platform = getPlatformFromChainId(chainId);
    if (!platform) {
      console.warn(`No platform mapping found for chain ID ${chainId}`);
      return [];
    }

    console.log(
      `Fetching tokens for chain ID ${chainId} (platform: ${platform})...`,
    );

    const allTokens = await getAllCoinGeckoTokens();
    const tokensOnChain = allTokens
      .filter((token) => token.platforms && platform in token.platforms)
      .map((token) => ({
        id: token.id,
        symbol: token.symbol,
        name: token.name,
        address: token.platforms[platform],
      }))
      .filter((token) => token.address && token.address.length > 0);

    console.log(`Found ${tokensOnChain.length} tokens for chain ID ${chainId}`);
    return tokensOnChain;
  } catch (err) {
    console.error(`Error fetching tokens for chain ${chainId}:`, err);
    return [];
  }
};

/**
 * Fetches prices for multiple tokens across multiple chains
 * @param tokens Map of chain IDs to token addresses
 * @returns Map of token addresses to prices by chain ID
 */
export const getMultiChainTokenPrices = async (
  tokens: Record<number, string[]>,
): Promise<Record<number, Record<string, DexTokenPrice>>> => {
  // Ensure mappings are initialized first
  await initializePlatformMappings();

  const results: Record<number, Record<string, DexTokenPrice>> = {};

  // Process each chain
  await Promise.all(
    Object.entries(tokens).map(async ([chainIdStr, addresses]) => {
      const chainId = parseInt(chainIdStr);
      if (addresses.length === 0) return;

      try {
        const prices = await getDexPrices(addresses, chainId);
        results[chainId] = prices;
      } catch (err) {
        console.error(`Error fetching prices for chain ${chainId}:`, err);
        results[chainId] = {};
      }
    }),
  );

  return results;
};

/**
 * Gets the most popular tokens by market cap for a specific chain
 * @param chainId The chain ID to get popular tokens for
 * @param limit Maximum number of tokens to return (default: 20)
 */
export const getPopularTokensForChain = async (
  chainId: number,
  limit = 20,
): Promise<PopularToken[]> => {
  // Ensure mappings are initialized first
  await initializePlatformMappings();

  try {
    const platform = getPlatformFromChainId(chainId);
    if (!platform) {
      console.warn(`No platform mapping found for chain ID ${chainId}`);
      return [];
    }

    // For this we need to use the coins/markets endpoint to get market cap ranking
    const { data } = await coinGeckoApi.get<CoinGeckoMarketItem[]>(
      "/coins/markets",
      {
        params: {
          vs_currency: "usd",
          order: "market_cap_desc",
          per_page: 250,
          page: 1,
          sparkline: false,
        },
      },
    );

    // Get tokens on this chain
    const tokensOnChain = await getTokensForChain(chainId);

    // Create a map of coin ids to their respective token data
    const tokenMap = new Map<string, TokenWithAddress>();
    tokensOnChain.forEach((token) => {
      tokenMap.set(token.id, token);
    });

    // Filter and sort the ranked tokens that are available on this chain
    const popularTokens = data
      .filter((item) => tokenMap.has(item.id))
      .map((item) => {
        const token = tokenMap.get(item.id)!;
        return {
          ...token,
          market_cap: item.market_cap,
          current_price: item.current_price,
          price_change_percentage_24h: item.price_change_percentage_24h,
        };
      })
      .slice(0, limit);

    return popularTokens;
  } catch (err) {
    console.error(`Error fetching popular tokens for chain ${chainId}:`, err);
    return [];
  }
};

// Initialize mappings at module load time
initializePlatformMappings().catch((err) => {
  console.error("Failed to initialize platform mappings on load:", err);
});
