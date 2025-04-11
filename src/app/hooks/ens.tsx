import { useMemo, useCallback } from "react";
import { getClientProvider } from "core/client";
import { AvatarResolver } from "@ensdomains/ens-avatar";
import { isAddress } from "ethers";
import { ZERO_ADDRESSES } from "core/common";

const NAME_SPACES = [
  ".eth",
  ".bnb",
  ".gno",
  ".arb",
  // ".manta",
  // ".cake",
  // ".zeta",
  // ".ll",
  // ".mint",
  // ".mode",
  // ".inj",
  // ".taiko",
];

const ONE_DAY = 24 * 60 * 60 * 1000;

const toDataURL = async (url: string) =>
  fetch(url)
    .then((response) => response.blob())
    .then(
      (blob) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        }),
    );

const useEns = () => {
  const provider = getClientProvider(1);

  const getEnsName = useCallback(
    async (address: string) => {
      const ensNameLS = localStorage.getItem(`ENS_${address}`);
      const parsedData = ensNameLS ? JSON.parse(ensNameLS) : null;
      if (parsedData && parsedData.expirationTimestamp > Date.now()) {
        return parsedData.ensName;
      } else {
        const ensName = await provider.lookupAddress(address);
        const name = ensName;

        const data = {
          ensName: name || null,
          expirationTimestamp: Date.now() + ONE_DAY,
        };
        localStorage.setItem(`ENS_${address}`, JSON.stringify(data));

        if (name) {
          return name;
        } else {
          return null;
        }
      }
    },
    [provider],
  );

  const getAddressByEns = useCallback(
    async (ensName: string) => {
      try {
        // ENS
        const addressEns = await provider
          .resolveName(ensName)
          .catch(() => null);

        if (addressEns) {
          return addressEns;
        }

        // Space ID
        let tld = ensName.split(".").pop();
        if (tld === "arb") tld = "arb1";
        const address = await fetch(
          `https://api.prd.space.id/v1/getAddress?tld=${tld}&domain=${ensName}`,
        )
          .then((res) => res.json())
          .then((data) => data?.address || null)
          .catch(console.warn);

        if (isAddress(address) && !ZERO_ADDRESSES.has(address.toLowerCase())) {
          return address;
        }
      } catch (err) {
        console.warn(err);
      }

      return null;
    },
    [provider],
  );

  const getEnsAvatar = useCallback(
    async (ensName: string) => {
      const ensAvatarLS = localStorage.getItem(`ENS_AVATAR_${ensName}`);
      const parsedData = ensAvatarLS ? JSON.parse(ensAvatarLS) : null;
      if (parsedData && parsedData.expirationTimestamp > Date.now()) {
        return parsedData.imageUrl;
      } else {
        //@ts-expect-error: Should expect JsonRpcProvider
        const resolver = new AvatarResolver(provider);
        const imageUrl = await resolver
          .getAvatar(ensName, {})
          .catch(() => null);

        if (imageUrl) {
          const imageDataUrl = await toDataURL(imageUrl);

          const data = {
            imageUrl: imageDataUrl,
            expirationTimestamp: Date.now() + ONE_DAY,
          };

          localStorage.setItem(`ENS_AVATAR_${ensName}`, JSON.stringify(data));

          return imageDataUrl;
        } else {
          return null;
        }
      }
    },
    [provider],
  );

  const watchEns = useCallback(
    async (value: any, cb: (address: string) => void) => {
      const ethereumAddressOrENSRegex =
        /^(0x[a-fA-F0-9]{40})|([a-zA-Z0-9-_]+\.[a-zA-Z]+)$/;
      if (value && typeof value == "string") {
        const isValid = ethereumAddressOrENSRegex.test(value);
        if (isValid && NAME_SPACES.some((ns) => value.endsWith(ns))) {
          const response = await getAddressByEns(value);
          if (response) {
            cb(response);
          }
        }
      }
    },
    [getAddressByEns],
  );

  return useMemo(
    () => ({
      getEnsName,
      getEnsAvatar,
      getAddressByEns,
      watchEns,
    }),
    [getEnsName, getEnsAvatar, getAddressByEns, watchEns],
  );
};

export { useEns };
