// auth-manager.js - Complete authentication management
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class AuthManager {
    constructor(config) {
        this.apiKey = config.apiKey;
        this.apiSecret = config.apiSecret;
        this.redirectUri = config.redirectUri;
        this.analyticsToken = config.analyticsToken;
        this.authCode = config.authCode;
        this.dataDir = config.dataDir || './market_data';
        this.tokenCachePath = path.join(this.dataDir, '.token_cache.json');
    }

    // Main public method - tries all authentication methods in order
    async getValidAccessToken() {
        console.log('\n🔐 Authentication starting...');
        console.log('━'.repeat(50));
        
        // METHOD 1: Analytics Token (1-year validity, no daily work)
        const analyticsToken = await this.getAnalyticsToken();
        if (analyticsToken) {
            console.log('✅ Analytics Token authenticated successfully');
            return analyticsToken;
        }
        
        console.log('━'.repeat(50));
        
        // METHOD 2: Cached OAuth Token
        const cachedToken = await this.getCachedToken();
        if (cachedToken) {
            console.log('✅ Cached OAuth token authenticated successfully');
            return cachedToken;
        }
        
        console.log('━'.repeat(50));
        
        // METHOD 3: Fresh OAuth Token with Auth Code
        const freshToken = await this.getFreshOAuthToken();
        if (freshToken) {
            console.log('✅ Fresh OAuth token generated and authenticated');
            return freshToken;
        }
        
        console.log('━'.repeat(50));
        
        // All methods failed
        throw new Error(this.getAuthErrorMessage());
    }

    // Method 1: Analytics Token
    async getAnalyticsToken() {
        if (!this.analyticsToken) {
            console.log('ℹ️ No Analytics Token configured in .env');
            return null;
        }
        
        console.log('📌 Trying Analytics Token...');
        
        // Remove quotes if present (from .env)
        const token = this.analyticsToken.replace(/^['"]|['"]$/g, '');
        
        const isValid = await this.testToken(token);
        if (isValid) {
            console.log('✅ Analytics Token is valid');
            return token;
        } else {
            console.log('❌ Analytics Token validation failed');
            return null;
        }
    }

    // Method 2: Cached OAuth Token
    async getCachedToken() {
        try {
            const data = await fs.readFile(this.tokenCachePath, 'utf8');
            const cached = JSON.parse(data);
            
            if (cached.expires_at && new Date(cached.expires_at) > new Date()) {
                console.log('📌 Trying cached OAuth token...');
                const isValid = await this.testToken(cached.token);
                
                if (isValid) {
                    console.log('✅ Cached OAuth token is valid');
                    return cached.token;
                } else {
                    console.log('❌ Cached OAuth token expired or invalid');
                    return null;
                }
            }
            return null;
        } catch (error) {
            console.log('ℹ️ No valid cached token found');
            return null;
        }
    }

    // Method 3: Fresh OAuth Token
    async getFreshOAuthToken() {
        if (!this.authCode) {
            console.log('ℹ️ No auth code configured, cannot generate fresh token');
            return null;
        }
        
        if (!this.apiKey || !this.apiSecret) {
            console.log('ℹ️ API key or secret missing for OAuth');
            return null;
        }
        
        console.log('📌 Generating fresh OAuth token...');
        
        try {
            const params = new URLSearchParams();
            params.append('code', this.authCode);
            params.append('client_id', this.apiKey);
            params.append('client_secret', this.apiSecret);
            params.append('redirect_uri', this.redirectUri);
            params.append('grant_type', 'authorization_code');

            const response = await axios.post(
                'https://api.upstox.com/v2/login/authorization/token',
                params.toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json'
                    }
                }
            );

            let token = null;
            if (response.data && response.data.access_token) {
                token = response.data.access_token;
            } else if (response.data && response.data.data && response.data.data.access_token) {
                token = response.data.data.access_token;
            }

            if (token) {
                await this.cacheToken(token);
                return token;
            }
            
            throw new Error('No token in response');
        } catch (error) {
            console.error('❌ Fresh OAuth token generation failed:', error.response?.data?.message || error.message);
            return null;
        }
    }

    // Test if a token is valid
    async testToken(token) {
        if (!token) return false;
        
        try {
            const response = await axios.get('https://api.upstox.com/v2/user/profile', {
                headers: { 'Authorization': `Bearer ${token}` },
                timeout: 10000
            });
            return response.data.status === 'success';
        } catch (error) {
            if (error.response?.status === 401) {
                return false;
            }
            // Network error - log but don't fail immediately
            console.warn(`⚠️ Token test network error: ${error.message}`);
            return false;
        }
    }

    // Cache a successful token
    async cacheToken(token) {
        // Token expires at 3:30 AM IST
        const expiryIST = new Date();
        expiryIST.setUTCHours(22, 0, 0, 0); // 3:30 AM IST = 10:00 PM UTC (simplified)
        
        if (new Date() > expiryIST) {
            expiryIST.setUTCDate(expiryIST.getUTCDate() + 1);
        }
        
        const cacheData = {
            token: token,
            expires_at: expiryIST.toISOString(),
            generated_at: new Date().toISOString()
        };
        
        // Ensure data directory exists
        const fsSync = require('fs');
        if (!fsSync.existsSync(this.dataDir)) {
            fsSync.mkdirSync(this.dataDir, { recursive: true });
        }
        
        await fs.writeFile(this.tokenCachePath, JSON.stringify(cacheData, null, 2));
        console.log('📁 Token cached successfully');
    }

    // Generate authorization URL for manual OAuth (fallback)
    generateAuthUrl() {
        const state = crypto.randomBytes(16).toString('hex');
        return `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${this.apiKey}&redirect_uri=${this.redirectUri}&state=${state}`;
    }

    // Get error message with instructions
    getAuthErrorMessage() {
        const hasAnalytics = !!this.analyticsToken;
        const hasOAuthCreds = !!(this.apiKey && this.apiSecret && this.redirectUri);
        
        let message = `
╔═══════════════════════════════════════════════════════════════════════════╗
║                         ❌ AUTHENTICATION FAILED                          ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  No authentication method succeeded.                                     ║
║                                                                           ║
║  Please configure ONE of the following in your .env file:                ║
║                                                                           ║
`;
        
        if (!hasAnalytics) {
            message += `║  OPTION 1 (Recommended - 1 year validity):                               ║\n`;
            message += `║    UPSTOX_ANALYTICS_TOKEN=your_token                                     ║\n`;
            message += `║    Get it from: Developer Dashboard → Your App → Analytics Tab           ║\n`;
            message += `║                                                                           ║\n`;
        }
        
        if (!hasOAuthCreds) {
            message += `║  OPTION 2 (OAuth - requires daily auth code):                            ║\n`;
            message += `║    UPSTOX_API_KEY=your_api_key                                           ║\n`;
            message += `║    UPSTOX_API_SECRET=your_api_secret                                     ║\n`;
            message += `║    UPSTOX_REDIRECT_URI=your_redirect_uri                                 ║\n`;
            message += `║    UPSTOX_AUTH_CODE=your_auth_code                                       ║\n`;
        }
        
        message += `║                                                                           ║\n`;
        message += `╚═══════════════════════════════════════════════════════════════════════════╝`;
        
        return message;
    }
}

module.exports = AuthManager;