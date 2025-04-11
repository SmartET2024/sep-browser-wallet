import axios from "axios";

export const indexerApi = axios.create({
  baseURL: process.env.WIGWAM_INDEXER_API!,
  timeout: 120_000,
  headers: {
    "X-API-KEY": process.env.WIGWAM_INDEXER_API_KEY,
  },
});

indexerApi.interceptors.request.use(async (config) => {
  if (config.params?._authAddress) {
    delete config.params._authAddress;
  }
  return config;
});
