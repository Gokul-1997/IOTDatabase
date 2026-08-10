import { io, Socket } from 'socket.io-client';
import { SOCKET_URL } from './config';
import { secureTokenStore } from './secureTokenStore';
import { getRefreshedAccessToken } from './client';

// Mirrors FrontendIOT/src/app/core/services/socket.service.ts: the backend
// pushes machineUpdate over the plant's room the instant new MQTT telemetry
// lands (via Redis pub/sub — see Backend/src/server.js), which is how the
// web dashboard gets sub-second status/alarm updates instead of only
// relying on the periodic REST poll. This is that same channel for mobile.

export interface MachineUpdatePayload {
  machine_id: number;
  plant_id: number;
  machine_status?: string;
  alarm?: boolean;
  received_at?: string | number;
}

let socket: Socket | null = null;
let connecting: Promise<void> | null = null;
let joinedPlantId: number | null = null;
let refreshing = false;

async function buildSocket(): Promise<Socket> {
  const token = await secureTokenStore.getAccessToken();

  const s = io(SOCKET_URL, {
    transports: ['websocket'],
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
    auth: { token },
  });

  s.on('connect', () => {
    refreshing = false;
    if (joinedPlantId != null) s.emit('joinPlant', joinedPlantId);
  });

  // Same distinct error messages as the web client (see server.js socket
  // auth middleware): TOKEN_EXPIRED is recoverable via silent refresh,
  // Unauthorized (tampered/invalid token) is not.
  s.on('connect_error', async (err) => {
    if (err.message === 'TOKEN_EXPIRED') {
      if (refreshing) return;
      refreshing = true;
      const newToken = await getRefreshedAccessToken();
      refreshing = false;
      if (newToken) {
        (s.auth as any).token = newToken;
        s.connect();
      }
      // If refresh failed, the HTTP layer's own 401 handling will already
      // be signing the user out — nothing extra to do here.
    }
  });

  return s;
}

export async function connectSocket(): Promise<void> {
  if (socket?.connected) return;
  if (connecting) return connecting;

  connecting = (async () => {
    if (!socket) socket = await buildSocket();
    if (socket.connected) return;

    await new Promise<void>((resolve, reject) => {
      socket!.once('connect', () => resolve());
      socket!.once('connect_error', (err) => {
        // TOKEN_EXPIRED resolves itself via the reconnect above.
        if (err.message !== 'TOKEN_EXPIRED') reject(err);
      });
      socket!.connect();
    });
  })();

  try {
    await connecting;
  } finally {
    connecting = null;
  }
}

export function joinPlant(plantId: number): void {
  joinedPlantId = plantId;
  if (socket?.connected) socket.emit('joinPlant', plantId);
}

export function onMachineUpdate(callback: (data: MachineUpdatePayload) => void): void {
  socket?.off('machineUpdate');
  socket?.on('machineUpdate', callback);
}

export function offMachineUpdate(): void {
  socket?.off('machineUpdate');
}

/** Full disconnect — call only on sign-out, not on screen unmount. */
export function disconnectSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
  joinedPlantId = null;
}
