import { Network } from "core/types";

export const SEC: Network[] = [
  // Mainnet
  {
    chainId: 19516,
    type: "mainnet",
    rpcUrls: ["https://rpc.secexplorer.io/"],
    chainTag: "sec",
    name: "Smart Energy Chain",
    nativeCurrency: {
      symbol: "SEP",
      name: "SEP Native Token",
      decimals: 18,
    },
    explorerUrls: ["https://secexplorer.io/"],
    explorerApiUrl: "https://secexplorer.io/api-docs",
    faucetUrls: [],
    infoUrl: "https://smartenergychain.org",
  },
];
