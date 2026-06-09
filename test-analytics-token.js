// test-auth.js - Test authentication
require('dotenv').config();
const AuthManager = require('./auth-manager');

async function test() {
    console.log('Testing Authentication Manager...');
    console.log('Analytics Token present:', !!process.env.UPSTOX_ANALYTICS_TOKEN);
    console.log('API Key present:', !!process.env.UPSTOX_API_KEY);
    
    const auth = new AuthManager({
        apiKey: process.env.UPSTOX_API_KEY,
        apiSecret: process.env.UPSTOX_API_SECRET,
        redirectUri: process.env.UPSTOX_REDIRECT_URI,
        analyticsToken: process.env.UPSTOX_ANALYTICS_TOKEN,
        authCode: process.env.UPSTOX_AUTH_CODE,
        dataDir: './market_data'
    });
    
    try {
        const token = await auth.getValidAccessToken();
        console.log('\n✅ SUCCESS! Token obtained');
        console.log(`   Token starts with: ${token.substring(0, 30)}...`);
        console.log(`   Token length: ${token.length} characters`);
    } catch (error) {
        console.error('\n❌ FAILED:', error.message);
    }
}

test();