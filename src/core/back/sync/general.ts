import { storage } from "lib/ext/storage";

import { CHAIN_ID, TokenType } from "core/types";

import { syncStarted, synced } from "../state";
import { syncConversionRates } from "./currencyConversion";
import {
  enqueueTokensSync,
  syncNetworks,
  syncAccountTokens,
  refreshTotalBalances,
  isFirstSync,
} from "./tokens";

// Check if sync should be skipped for development
const SKIP_SYNC = process.env.WIGWAM_DEV_SKIP_SYNC === "true";

export async function addSyncRequest(
  chainId: number,
  accountAddress: string,
  tokenType: TokenType,
) {
  let syncStartedAt: number | undefined;

  setTimeout(() => {
    if (!syncStartedAt) syncStarted(accountAddress);
    syncStartedAt = Date.now();
  }, 300);

  try {
    // If SEP Chain, make sure to set the active chain ID in storage
    if ((chainId === 19516 || chainId === 19515) && SKIP_SYNC) {
      await storage.put(CHAIN_ID, chainId);
      console.log("Development mode: Set chain ID to", chainId);
      return; // Skip the rest of the sync process
    }

    if (!SKIP_SYNC) {
      await syncConversionRates();

      await enqueueTokensSync(accountAddress, async () => {
        const firstSync = await isFirstSync(accountAddress);
        const mostValuedChainId = await syncNetworks(accountAddress, chainId);

        await syncAccountTokens(tokenType, chainId, accountAddress);

        if (tokenType === TokenType.Asset) {
          await refreshTotalBalances(chainId, accountAddress);
        }

        if (firstSync && mostValuedChainId && mostValuedChainId !== chainId) {
          await storage.put(CHAIN_ID, mostValuedChainId);
        }
      });
    } else {
      // In development mode with SKIP_SYNC enabled, just simulate a successful sync
      console.log("Development mode: Skipping actual sync operations");
    }
  } catch (err) {
    console.error(err);
  } finally {
    if (syncStartedAt) {
      setTimeout(
        () => synced(accountAddress),
        Math.max(0, syncStartedAt + 1_000 - Date.now()),
      );
    } else {
      syncStartedAt = 1;
    }
  }
}
