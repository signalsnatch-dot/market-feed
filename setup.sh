#!/bin/bash

# Install dependencies
npm install ws axios protobufjs

#export REDIRECT_URI='https://13.235.73.251/redirect'
#export UPSTOX_API_SECRET='x5u2jcn4ct'
#export UPSTOX_API_KEY='91c8d958-cb75-4dff-add4-06dbd3df7a61'



# Create data directory
mkdir -p market_data

# First time setup - get auth code
echo "=== Upstox Market Feed Setup ==="
echo ""
echo "Step 1: Get your API credentials from Upstox Dashboard"
echo "Step 2: Set environment variables:"
echo "  export UPSTOX_API_KEY='your_api_key'"
echo "  export UPSTOX_API_SECRET='your_api_secret'"
echo "  export REDIRECT_URI='https://your-app.com/callback'"
echo ""
echo "Step 3: Run the application to get authorization URL"
echo "  node index.js"
echo ""
echo "Step 4: Copy the 'code' from redirect URL and run:"
echo "  AUTH_CODE=your_code node index.js"
echo ""

# Save token for reuse within same day
echo "Token will be cached in market_data/.token_cache for reuse"
