# SEP Wallet - Smart Energy Chain Browser Extension

A browser extension wallet designed specifically for the Smart Energy Chain (SEP) ecosystem.

## Features

- Built-in support for Smart Energy Chain Mainnet and Testnet
- Track SEP token prices via CoinGecko integration
- Easy account creation and management
- Connect to dApps that support Web3 wallets
- View your token balances and transaction history
- Send and receive SEP tokens

## Installation Instructions

1. **Install from Source**:
   - Download or clone this repository
   - Run `./build.sh` to build the extension
   - The extension will be built in `dist/prod/chrome_unpacked`

2. **Load in Chrome/Edge/Brave**:
   - Open Chrome (or any Chromium-based browser)
   - Go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in the top right)
   - Click "Load unpacked"
   - Select the `dist/prod/chrome_unpacked` directory

3. **Getting Started**:
   - Click on the SEP Wallet extension icon in your browser toolbar
   - Create a new wallet or import an existing one
   - Your wallet will automatically connect to Smart Energy Chain networks

## Troubleshooting

If you encounter an error screen:
1. Ensure you have an active internet connection
2. Try restarting the extension
3. Make sure your Smart Energy Chain RPC endpoints are accessible
4. Consider using the development mode settings in the `.env` file

## Smart Energy Chain Network Details

### Mainnet
- Network Name: Smart Energy Chain Mainnet
- RPC URL: https://rpc.secexplorer.io/
- Chain ID: 19516
- Currency Symbol: SEP
- Block Explorer URL: https://secexplorer.io/

### Testnet
- Network Name: Smart Energy Chain Testnet
- RPC URL: https://testnet-rpc.secexplorer.io/
- Chain ID: 19515
- Currency Symbol: SEP
- Block Explorer URL: https://testnet.secexplorer.io/

## Development Mode

To enable development features that help with debugging:
1. Edit the `.env` file
2. Set `WIGWAM_DEV_UNLOCK_PASSWORD=test` for a simple default password
3. Set `WIGWAM_DEV_SKIP_SYNC=true` to bypass network synchronization
4. Rebuild the extension with `./build.sh` 