import Constants from 'expo-constants';

// Set per environment via app.json -> expo.extra, or EAS build profile env vars.
// Falls back to local dev backend (Backend/src/server.js listens on 8000).
const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;

export const API_BASE_URL = extra?.apiBaseUrl ?? 'http://localhost:8000/api';

// Socket.IO runs on the same server as the API, one path level up
// (mirrors FrontendIOT/src/environments — same host, no /api suffix).
export const SOCKET_URL = API_BASE_URL.replace(/\/api\/?$/, '');
