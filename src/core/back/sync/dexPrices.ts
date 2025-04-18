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
const ONE_DAY = 24 * 60 * 60_000;
const ADDITIONAL_PLATFORM_COINS = new Map([[800001, "octaspace"]]);

export const coinGeckoApi = axios.create({
  baseURL: "https://api.coingecko.com/api/v3",
  timeout: 90_000,
  headers: {
    "x-cg-demo-api-key": "COINGECKO_API_KEY_HERE",
  },
});

export const coinGeckoTerminalApi = axios.create({
  baseURL: "https://api.geckoterminal.com/api/v2",
  timeout: 90_000,
});

export const dexScreenerApi = axios.create({
  baseURL: "https://api.dexscreener.com/latest",
  timeout: 90_000,
});

const tokenPricesCache = new ExpiryMap<string, DexTokenPrice>(THREE_MIN);

// export async function getDexPrices(tokenAddresses: string[], chainId?: number) {
//   try {
//     if (tokenAddresses.length === 0) return {};
//     if (tokenAddresses.length > 1000) return {}; // To much

//     const allCoinIds = await getCoinGeckoCoinIds();

//     const data: DexPrices = {};

//     const tokensToRefresh: { tokenAddress: string; coinId: string }[] = [];
//     const coinsToRefreshSet = new Set<string>();
//     const missedAddresses = new Set<string>();

//     for (const tokenAddress of tokenAddresses) {
//       const coinIdsByChain = allCoinIds[tokenAddress.toLowerCase()];

//       const coinId = coinIdsByChain
//         ? chainId
//           ? coinIdsByChain[chainId]
//           : Object.values(coinIdsByChain)[0]
//         : undefined;
//       const cached = tokenPricesCache.get(
//         coinId ?? `${chainId ?? ""}_${tokenAddress}`,
//       );

//       if (cached) {
//         data[tokenAddress] = cached;
//         continue;
//       }

//       if (coinId) {
//         tokensToRefresh.push({ tokenAddress, coinId });
//         coinsToRefreshSet.add(coinId);
//       } else {
//         missedAddresses.add(tokenAddress);
//       }
//     }

//     // Coin gecko - simple
//     if (coinsToRefreshSet.size > 0) {
//       const freshCoinPrices: DexPrices = {};
//       const coinsToRefresh = Array.from(coinsToRefreshSet);

//       while (coinsToRefresh.length > 0) {
//         const nextCoins = coinsToRefresh.splice(0, 100);

//         const res = await indexerApi.get<DexPrices>("/cg/simple/price", {
//           params: {
//             ids: nextCoins.join(),
//             vs_currencies: "USD",
//             include_24hr_change: true,
//           },
//         });

//         if (!res) continue;

//         Object.assign(freshCoinPrices, res.data);
//       }

//       // Cache new prices
//       for (const coinId in freshCoinPrices) {
//         tokenPricesCache.set(coinId, freshCoinPrices[coinId]);
//       }

//       // Update data to return
//       for (const { tokenAddress, coinId } of tokensToRefresh) {
//         const prices = freshCoinPrices[coinId];
//         if (prices) data[tokenAddress] = prices;
//       }
//     }

//     // Dex screener
//     if (missedAddresses.size > 0 && missedAddresses.size <= 500) {
//       const addressesToRefresh = Array.from(missedAddresses);

//       try {
//         while (addressesToRefresh.length > 0) {
//           const nextAddresses = addressesToRefresh.splice(0, 30);

//           const res = await dexScreenerApi
//             .get(`/dex/tokens/${nextAddresses.join()}`)
//             .catch(() => null);

//           const dsPairs = res?.data?.pairs;
//           if (!dsPairs) continue;

//           for (const pair of dsPairs) {
//             const reserveBN = new BigNumber(pair.liquidity?.usd);

//             if (reserveBN.isNaN() || reserveBN.isLessThan(100)) {
//               continue;
//             } else {
//               const baseBN = new BigNumber(pair.liquidity.base);
//               const quoteBN = new BigNumber(pair.liquidity.quote);

//               if (baseBN.isLessThan(0.01) || quoteBN.isLessThan(0.01)) {
//                 continue;
//               }
//             }

//             const tokenAddress = getAddress(pair.baseToken?.address);
//             const existing = data[tokenAddress];

//             if (
//               existing?.usd_reserve &&
//               new BigNumber(existing.usd_reserve).isGreaterThan(reserveBN)
//             ) {
//               continue;
//             }

//             const usdPrice = new BigNumber(pair.priceUsd).toNumber();
//             if (!usdPrice) continue;

//             const usdPriceChange =
//               new BigNumber(pair.priceChange?.h24).toNumber() || undefined;

//             const price: DexTokenPrice = {
//               usd: usdPrice,
//               usd_24h_change: usdPriceChange,
//               usd_reserve: reserveBN.toString(),
//             };

//             data[tokenAddress] = price;
//             tokenPricesCache.set(`${chainId ?? ""}_${tokenAddress}`, price);
//           }
//         }
//       } catch (err) {
//         console.error(err);
//       }
//     }

//     return data;
//   } catch (err) {
//     console.error(err);
//     return {};
//   }
// }

type Coin = {
  id: string;
  chainId: number;
  symbol: string;
  name: string;
};

export async function getDexPrices(tokenAddresses: string[], chainId?: number) {
  try {
    const coinsList: Coin[] = [
      {
        id: "ethereum",
        chainId: 1,
        symbol: "eth",
        name: "Ethereum",
      },
      {
        id: "matic-network",
        chainId: 137,
        symbol: "matic",
        name: "Polygon",
      },
      {
        id: "smart-energy-pay",
        chainId: 19516,
        symbol: "sep",
        name: "Smart Energy Pay",
      },
    ];

    const data: DexPrices = {};

    // Get platform ID from coinsList based on chainId
    const platformId = coinsList.find((coin) => coin.chainId === chainId)?.id;
    if (!platformId) return {};

    // Filter out zero address (native token)
    const erc20Addresses = tokenAddresses.filter(
      (addr) => addr !== "0x0000000000000000000000000000000000000000",
    );

    // Dummy data for common tokens
    // const dummyPrices: Record<string, DexTokenPrice> = {
    //   // SED
    //   "0x32ed35a604f480967de31911c3717acc7b4dc136": {
    //     usd: 0.00571939,
    //     usd_24h_change: 0.15869912523572458,
    //     usd_reserve: "800000000",
    //   },
    // };

    if (erc20Addresses.length > 0) {
      // console.log(`Token Addresses: ${JSON.stringify(erc20Addresses)}`);
      // console.log(`Platform ID: ${platformId}`);

      const dummyPrices: Record<string, DexTokenPrice> =
        await fetchCoinGeckoTokenPrices(
          platformId,
          erc20Addresses.length > 1
            ? erc20Addresses.join(",")
            : erc20Addresses[0],
          "usd",
        );

      // console.log(`Prices Tokens: ${JSON.stringify(dummyPrices)}`);

      // Return dummy data for requested tokens
      for (const tokenAddress of erc20Addresses) {
        const normalizedAddress = tokenAddress.toLowerCase();
        if (dummyPrices[normalizedAddress]) {
          data[tokenAddress] = dummyPrices[normalizedAddress];
        } else {
          // For unknown tokens, return a default price
          data[tokenAddress] = {
            usd: 1.0,
            usd_24h_change: 0,
            usd_reserve: "1000000",
          };
        }
      }
    }

    return data;
  } catch (err) {
    console.error(err);
    return {};
  }
}

export const fetchCoinGeckoTokenPrices = memoize(
  async (
    platformId: string,
    contractAddresses: string,
    vs_currencies: string = "usd",
  ): Promise<DexPrices> => {
    // console.log("Request URL:", `/simple/token_price/${platformId}`);
    // console.log("Request Params:", {
    //   contract_addresses: contractAddresses,
    //   vs_currencies,
    // });
    try {
      const response = await coinGeckoApi.get(
        `/simple/token_price/${platformId}`,
        {
          params: {
            contract_addresses: contractAddresses,
            vs_currencies: vs_currencies,
          },
        },
      );

      return response.data;
    } catch (err) {
      console.error("Error fetching CoinGecko token prices:", err);
      return {};
    }
  },
  {
    maxAge: THREE_MIN, // 3 min
  },
);

export const getCoinGeckoNativeTokenPrice = async (chainId: number) => {
  try {
    // Dummy platform IDs and chain IDs mapping
    const dummyPlatformIds: Record<
      string,
      { native_coin_id: string; chain_id: number }
    > = {
      "smart-energy-pay": {
        native_coin_id: "smart-energy-pay",
        chain_id: 19516,
      },
      "smart-energy-pay-testnet": {
        native_coin_id: "smart-energy-pay-testnet",
        chain_id: 19516,
      },
      ethereum: { native_coin_id: "ethereum", chain_id: 1 },
      "polygon-pos": { native_coin_id: "matic-network", chain_id: 137 },
      "binance-smart-chain": { native_coin_id: "binancecoin", chain_id: 56 },
      "optimistic-ethereum": { native_coin_id: "ethereum", chain_id: 10 },
      "arbitrum-one": { native_coin_id: "ethereum", chain_id: 42161 },
      avalanche: { native_coin_id: "avalanche-2", chain_id: 43114 },
      zksync: { native_coin_id: "ethereum", chain_id: 324 },
      xdai: { native_coin_id: "xdai", chain_id: 100 },
      base: { native_coin_id: "ethereum", chain_id: 8453 },
      cronos: { native_coin_id: "crypto-com-chain", chain_id: 25 },
      fantom: { native_coin_id: "fantom", chain_id: 250 },
      mantle: { native_coin_id: "mantle", chain_id: 5000 },
      celo: { native_coin_id: "celo", chain_id: 42220 },
      linea: { native_coin_id: "ethereum", chain_id: 59144 },
      scroll: { native_coin_id: "weth", chain_id: 534352 },
      blast: { native_coin_id: "blast-old", chain_id: 81457 },
      rootstock: { native_coin_id: "rootstock", chain_id: 30 },
      mode: { native_coin_id: "mode", chain_id: 34443 },
      moonbeam: { native_coin_id: "moonbeam", chain_id: 1284 },
      aurora: { native_coin_id: "aurora-near", chain_id: 1313161554 },
      moonriver: { native_coin_id: "moonriver", chain_id: 1285 },
      "arbitrum-nova": { native_coin_id: "ethereum", chain_id: 42170 },
      evmos: { native_coin_id: "evmos", chain_id: 9001 },
      "huobi-token": { native_coin_id: "huobi-token", chain_id: 128 },
      "harmony-shard-0": { native_coin_id: "harmony", chain_id: 1666600000 },
    };

    const nativeCoinIds = [
      "smart-energy-pay",
      "ethereum",
      "matic-network",
      "binancecoin",
      "avalanche-2",
      "xdai",
      "crypto-com-chain",
      "fantom",
      "mantle",
      "celo",
      "weth",
      "blast-old",
      "rootstock",
      "mode",
      "moonbeam",
      "aurora-near",
      "moonriver",
      "evmos",
      "huobi-token",
      "harmony",
    ];

    const dummyChainIds: Record<number, string> = {
      19516: "smart-energy-pay",
      19515: "smart-energy-pay-testnet",
      1: "ethereum",
      56: "binance-smart-chain",
      137: "polygon-pos",
      42161: "arbitrum-one",
      10: "optimistic-ethereum",
      43114: "avalanche",
      324: "zksync",
      100: "xdai",
      8453: "base",
      25: "cronos",
      250: "fantom",
      5000: "mantle",
      42220: "celo",
      59144: "linea",
      534352: "scroll",
      81457: "blast",
      30: "rootstock",
      34443: "mode",
      1284: "moonbeam",
      1313161554: "aurora",
      1285: "moonriver",
      42170: "arbitrum-nova",
      9001: "evmos",
      128: "huobi-token",
      1666600000: "harmony-shard-0",
    };

    // Dummy prices for native tokens
    // const dummyPrices: Record<string, DexTokenPrice> = {
    //   ethereum: {
    //     usd: 3500.42,
    //     usd_24h_change: 2.5,
    //     usd_reserve: "1000000000",
    //   },
    //   binancecoin: {
    //     usd: 300.15,
    //     usd_24h_change: 1.2,
    //     usd_reserve: "800000000",
    //   },
    //   "matic-network": {
    //     usd: 0.75,
    //     usd_24h_change: -0.5,
    //     usd_reserve: "500000000",
    //   },
    //   "smart-energy-pay": {
    //     usd: 0.00571939,
    //     usd_24h_change: 0.15869912523572458,
    //     usd_reserve: "800000000",
    //   },
    //   "smart-energy-pay-testnet": {
    //     usd: 0.00571939,
    //     usd_24h_change: 0.15869912523572458,
    //     usd_reserve: "800000000",
    //   },
    // };

    const dummyPrices = await fetchCoinGeckoPrices(nativeCoinIds.join(","));
    // Returns: { "smart-energy-pay": { usd: 0.005682, usd_24h_change: -0.3429139127518352 } }
    // console.log(prices);

    // console.log(`Prices Native Coin: ${JSON.stringify(dummyPrices)}`);

    // Get native coin ID for the chain
    const platformId = dummyChainIds[chainId];
    if (!platformId) return null;

    const nativeCoinId = dummyPlatformIds[platformId]?.native_coin_id;

    // console.log(`nativeCoinId: ${nativeCoinId}`);

    if (!nativeCoinId) return null;

    // Return the price if available, otherwise return null
    return dummyPrices[nativeCoinId] || null;
  } catch (err) {
    console.error(err);
    return null;
  }
};

// signed
export const fetchCoinGeckoPrices = memoize(
  async (
    ids: string,
    vs_currencies: string = "usd",
    include_24hr_change: boolean = true,
  ): Promise<DexPrices> => {
    try {
      const response = await coinGeckoApi.get("/simple/price", {
        params: {
          ids,
          vs_currencies,
          include_24hr_change,
        },
      });

      return response.data;
    } catch (err) {
      console.error("Error fetching CoinGecko prices:", err);
      return {};
    }
  },
  {
    maxAge: THREE_MIN, // 3 min
  },
);

// export const getCoinGeckoNativeTokenPrice = async (chainId: number) => {
//   try {
//     const { platformIds, chainIds } = await getCoinGeckoPlatformIds();

//     let nativeCoinId: string | undefined =
//       platformIds[chainIds[chainId]]?.native_coin_id;

//     if (!nativeCoinId) nativeCoinId = ADDITIONAL_PLATFORM_COINS.get(chainId);

//     if (!nativeCoinId) return null;

//     const prices = await getCoinGeckoPlatformPrices();

//     return nativeCoinId in prices ? prices[nativeCoinId] : null;
//   } catch (err) {
//     console.error(err);
//     return null;
//   }
// };

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
    const { data } = await coinGeckoApi.get("/asset_platforms");

    const platformIds: Record<
      string,
      { id: string; native_coin_id: string; chain_id: number }
    > = {};
    const chainIds: Record<number, string> = {};

    for (const { id, chain_identifier, native_coin_id } of data) {
      if (id && chain_identifier && typeof chain_identifier === "number") {
        // Fix wrong native_coin_id for taiko
        const nativeCoinId = id === "taiko" ? "ethereum" : native_coin_id;

        platformIds[id] = {
          id,
          native_coin_id: nativeCoinId,
          chain_id: chain_identifier,
        };
        chainIds[chain_identifier] = id;
      }
    }

    return { platformIds, chainIds };
  },
  {
    key: "cg_asset_platforms",
    hotMaxAge: 5_000,
    coldMaxAge: ONE_DAY,
  },
);
