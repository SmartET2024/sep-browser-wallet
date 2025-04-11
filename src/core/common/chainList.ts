import { withOfflineCache } from "lib/ext/offlineCache";
import { indexerApi } from "./indexerApi";

// Hardcoded networks for SEP Wallet to avoid API dependencies
const SEP_NETWORKS: EvmNetwork[] = [
  {
    chainId: 19516,
    name: "Smart Energy Chain",
    nativeCurrency: {
      name: "Smart Energy Chain",
      symbol: "SEP",
      decimals: 18,
    },
    rpcUrls: ["https://rpc.secexplorer.io/"],
    explorers: [
      {
        name: "Smart Energy Chain Explorer",
        url: "https://secexplorer.io/",
        apiUrl: "https://secexplorer.io/api"
      }
    ],
    icon: {
      url: ""
    },
    infoUrl: "https://secexplorer.io/",
    testnet: false
  },
  {
    chainId: 19515,
    name: "Smart Energy Chain Testnet",
    nativeCurrency: {
      name: "Smart Energy Chain",
      symbol: "SEP",
      decimals: 18,
    },
    rpcUrls: ["https://testnet-rpc.secexplorer.io/"],
    explorers: [
      {
        name: "Smart Energy Chain Testnet Explorer",
        url: "https://testnet.secexplorer.io/",
        apiUrl: "https://testnet.secexplorer.io/api"
      }
    ],
    icon: {
      url: ""
    },
    infoUrl: "https://testnet.secexplorer.io/",
    testnet: true
  }
];

export const getAllEvmNetworks = withOfflineCache(
  async () => {
    // Development mode - always return hardcoded networks
    if (process.env.WIGWAM_DEV_SKIP_SYNC === "true") {
      console.log("Using hardcoded SEP networks");
      return SEP_NETWORKS;
    }
    
    try {
      // Try to get networks from API first
      const res = await indexerApi.get<EvmNetwork[]>("/networks/all");
      return res.data;
    } catch (error) {
      console.warn("Failed to fetch networks from API, using hardcoded networks", error);
      // Fall back to hardcoded networks if API fails
      return SEP_NETWORKS;
    }
  },
  {
    key: "all_networks",
    hotMaxAge: 5_000,
    coldMaxAge: 12 * 60 * 60_000, // 12h
  },
);

export type EvmNetwork = {
  chainId: number;
  name: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];

  // meta
  explorers?: {
    name: string;
    url: string;
    apiUrl?: string;
  }[];
  icon?: {
    url: string;
  };
  infoUrl?: string;
  testnet?: boolean;
  faucets?: string[];
};
