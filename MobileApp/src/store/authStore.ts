import { create } from 'zustand';
import * as authApi from '../api/auth';
import { registerSessionExpiredHandler } from '../api/client';
import { secureTokenStore } from '../api/secureTokenStore';
import { disconnectSocket } from '../api/socket';
import { AuthUser } from '../types/auth';

interface AuthState {
  user: AuthUser | null;
  status: 'checking' | 'signedOut' | 'signedIn';
  error: string | null;
  bootstrap: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  status: 'checking',
  error: null,

  // Called once on app start: if a token exists we trust it optimistically —
  // the first authenticated API call will refresh/clear it if invalid.
  // The user profile is restored from the local cache saved at sign-in,
  // since there's no self-profile endpoint to re-fetch it from.
  bootstrap: async () => {
    const token = await secureTokenStore.getAccessToken();
    if (!token) {
      set({ status: 'signedOut' });
      return;
    }
    const user = await secureTokenStore.getUser<AuthUser>();
    set({ user, status: 'signedIn' });
  },

  signIn: async (email, password) => {
    set({ error: null });
    try {
      const { accessToken, refreshToken, user } = await authApi.login(email, password);
      await Promise.all([secureTokenStore.setTokens(accessToken, refreshToken), secureTokenStore.setUser(user)]);
      set({ user, status: 'signedIn' });
    } catch (e: any) {
      const message = e?.response?.data?.message ?? 'Unable to sign in. Please try again.';
      set({ error: message });
      throw e;
    }
  },

  signOut: async () => {
    const refreshToken = await secureTokenStore.getRefreshToken();
    disconnectSocket();
    await secureTokenStore.clear();
    set({ user: null, status: 'signedOut' });
    if (refreshToken) {
      authApi.logout(refreshToken).catch(() => {
        // Best-effort server-side revoke; local session is already cleared.
      });
    }
  },
}));

// Wire the API client's 401-after-refresh-failure event to a real sign-out.
registerSessionExpiredHandler(() => {
  useAuthStore.setState({ user: null, status: 'signedOut' });
});
