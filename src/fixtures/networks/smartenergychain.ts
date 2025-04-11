import { Network } from "core/types";

export const SMART_ENERGY_CHAIN: Network[] = [
  // Mainnet
  {
    chainId: 19516,
    type: "mainnet",
    rpcUrls: ["https://rpc.secexplorer.io/"],
    chainTag: "sep",
    name: "Smart Energy Chain",
    nativeCurrency: {
      symbol: "SEP",
      name: "Smart Energy Chain",
      decimals: 18,
    },
    explorerUrls: ["https://secexplorer.io/"],
    explorerApiUrl: "https://secexplorer.io/api",
    faucetUrls: [],
    infoUrl: "https://secexplorer.io/",
  },
  // Testnet
  {
    chainId: 19515,
    type: "testnet",
    rpcUrls: ["https://testnet-rpc.secexplorer.io/"],
    chainTag: "sep",
    name: "Smart Energy Chain Testnet",
    nativeCurrency: {
      symbol: "SEP",
      name: "Smart Energy Chain",
      decimals: 18,
    },
    explorerUrls: ["https://testnet.secexplorer.io/"],
    explorerApiUrl: "https://testnet.secexplorer.io/api",
    faucetUrls: ["https://testnet.secexplorer.io/faucet"],
    infoUrl: "https://testnet.secexplorer.io/",
  },
]; 