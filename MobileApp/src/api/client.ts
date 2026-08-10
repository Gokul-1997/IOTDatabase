import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from './config';
import { secureTokenStore } from './secureTokenStore';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

// Fired when the refresh token itself is invalid/expired — the app must
// return to the Login screen. Wired up once from the auth store to avoid
// a circular import between the store and the client.
let onSessionExpired: (() => void) | null = null;
export function registerSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await secureTokenStore.getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await secureTokenStore.getRefreshToken();
  if (!refreshToken) return null;

  try {
    const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
    const newAccessToken: string = data.accessToken;
    await secureTokenStore.setAccessToken(newAccessToken);
    return newAccessToken;
  } catch {
    return null;
  }
}

// Shared by the HTTP 401 path above and the socket TOKEN_EXPIRED path
// (socket.ts) so a near-simultaneous expiry never fires two refresh calls.
export function getRefreshedAccessToken(): Promise<string | null> {
  refreshInFlight = refreshInFlight ?? refreshAccessToken().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;

    if (error.response?.status === 401 && originalRequest && !originalRequest._retried) {
      originalRequest._retried = true;

      // Coalesce concurrent 401s (and any concurrent socket refresh) into one call.
      const newToken = await getRefreshedAccessToken();

      if (newToken) {
        originalRequest.headers.set('Authorization', `Bearer ${newToken}`);
        return apiClient(originalRequest);
      }

      await secureTokenStore.clear();
      onSessionExpired?.();
    }

    return Promise.reject(error);
  }
);
