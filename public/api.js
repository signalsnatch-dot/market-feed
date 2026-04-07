// public/api.js - API helpers for chart
const API = {
    async getInstruments() {
        const response = await fetch('/api/instruments');
        return response.json();
    },
    
    async getRecentCandles(type, limit = 200) {
        const response = await fetch(`/api/recent/${type}?limit=${limit}`);
        return response.json();
    },
    
    async getStats() {
        const response = await fetch('/api/stats');
        return response.json();
    }
};