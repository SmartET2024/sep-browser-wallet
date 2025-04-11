#!/bin/bash

# Clean up any existing builds
rm -rf dist/

# Set the environment variables directly 
export NODE_ENV=production
export WIGWAM_WEBSITE_ORIGIN=https://secexplorer.io
export WIGWAM_STATIC_CDN=https://secexplorer.io
# Use Blockscout API base URL structure
export WIGWAM_INDEXER_API=https://secexplorer.io/api
# Skip all backend API calls in development mode
export WIGWAM_DEV_UNLOCK_PASSWORD=test
export WIGWAM_DEV_ACTIVE_TAB_RELOAD=true
export WIGWAM_DEV_ELEMENTS_SPACING=false
export WIGWAM_DEV_BLOCK_TX_SEND=false
# Important: Skip network syncing completely
export WIGWAM_DEV_SKIP_SYNC=true
export WIGWAM_DEV_CONTROL_PANEL=true

# Run the build
yarn webpack --stats errors-warnings

echo "Build complete. Load the extension from dist/prod/chrome_unpacked" 