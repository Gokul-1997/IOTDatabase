import { Injectable, NgZone } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class SocketService {

  private socket!: Socket;

  private isConnecting = false;
  private paused = false;
  private refreshing = false;   // guard: only one token refresh at a time

  private plantId?: number;

  constructor(
    private zone:   NgZone,
    private auth:   AuthService,
    private router: Router
  ) { }

  /* ================= CONNECT ================= */

  async connect(): Promise<void> {

    if (this.socket?.connected) return;

    if (!this.socket) {

      this.socket = io(environment.socketUrl, {
        transports: ['websocket'],
        autoConnect: false,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
        auth: {
          token: localStorage.getItem('token')
        }
      });

      /* ===== PERSISTENT EVENT LISTENERS (set up once) ===== */

      this.socket.on('connect', () => {
        console.log('✅ Socket connected:', this.socket.id);
        this.refreshing = false;

        if (this.plantId) {
          this.joinPlant(this.plantId);
        }
      });

      this.socket.on('disconnect', (reason) => {
        console.log('⚠ Socket disconnected:', reason);
      });

      /*
       * TOKEN_EXPIRED  → backend explicitly says the JWT expired.
       *                  Refresh the access token silently, swap it
       *                  into socket.auth, then reconnect.
       *
       * Unauthorized   → invalid token (tampered / wrong secret).
       *                  Logout immediately — no point retrying.
       *
       * Old code sent generic 'Unauthorized' for ALL jwt errors, so
       * 'TOKEN_EXPIRED' never matched and the page was left broken.
       * Backend now sends distinct messages (see server.js).
       */
      this.socket.on('connect_error', (err) => {
        console.error('❌ Socket connect error:', err.message);

        if (err.message === 'TOKEN_EXPIRED') {

          if (this.refreshing) return;   // refresh already in progress
          this.refreshing = true;

          this.auth.refreshToken().subscribe({
            next: (res) => {
              (this.socket.auth as any).token = res.accessToken;
              this.socket.connect();
            },
            error: () => {
              // Refresh token also expired / revoked → force login
              console.warn('🔒 Refresh failed — redirecting to login');
              this.refreshing = false;
              this.auth.logout();
            }
          });

        } else if (err.message === 'Unauthorized') {
          // Invalid token — clear session and go to login
          console.warn('🔒 Unauthorized socket — redirecting to login');
          this.auth.logout();
        }
      });

    }

    if (this.isConnecting) return;

    this.isConnecting = true;

    return new Promise((resolve, reject) => {

      this.socket.once('connect', () => {
        this.isConnecting = false;
        resolve();
      });

      /*
       * Only reject on non-recoverable errors.
       * TOKEN_EXPIRED is recoverable (refresh is in progress above),
       * so we resolve after the reconnect succeeds via the persistent
       * 'connect' listener — don't reject here for that case.
       */
      this.socket.once('connect_error', (err) => {
        this.isConnecting = false;
        if (err.message !== 'TOKEN_EXPIRED') {
          reject(err);
        } else {
          // Token refresh is underway; resolve when the socket reconnects
          this.socket.once('connect', () => resolve());
        }
      });

      this.socket.connect();

    });

  }

  /* ================= JOIN ROOM ================= */

  joinPlant(plantId: number): void {

    this.plantId = plantId;

    if (!this.socket?.connected) {
      console.warn('⚠ Cannot join plant. Socket not connected.');
      return;
    }

    console.log('🏭 Joining plant:', plantId);

    this.socket.emit('joinPlant', plantId);

  }

  /* ================= MACHINE UPDATES ================= */

  onMachineUpdate(callback: (data: any) => void): void {

    if (!this.socket) return;

    this.socket.off('machineUpdate');

    this.socket.on('machineUpdate', (data) => {

      if (this.paused) return;

      /* Run inside Angular zone for UI updates */
      this.zone.run(() => {
        callback(data);
      });

    });

  }

  /* ================= PROGRAM TRANSFER PROGRESS ================= */

  /** Byte-level progress for transfers this user started. The server emits
   *  into a per-user room, so no filtering is needed here. */
  onTransferProgress(callback: (data: any) => void): void {

    if (!this.socket) return;

    this.socket.off('programTransferProgress');

    this.socket.on('programTransferProgress', (data) => {
      // deliberately not gated on `paused` — that pauses dashboard polling,
      // but a transfer the user just started must keep reporting.
      this.zone.run(() => callback(data));
    });
  }

  offTransferProgress(): void {
    if (!this.socket) return;
    this.socket.off('programTransferProgress');
  }

  /* ================= PAUSE / RESUME ================= */

  pauseUpdates(): void {
    console.log('⏸ Socket updates paused');
    this.paused = true;
  }

  resumeUpdates(): void {
    console.log('▶ Socket updates resumed');
    this.paused = false;
  }

  /* ================= OFF MACHINE UPDATE ================= */

  /** Unregister the machineUpdate listener without disconnecting the socket.
   *  Call this from component ngOnDestroy instead of disconnect(). */
  offMachineUpdate(): void {
    if (!this.socket) return;
    this.socket.off('machineUpdate');
  }

  /* ================= DISCONNECT ================= */

  /** Full disconnect — call only on logout, not on component destroy.
   *  Nulls out the socket so the next connect() rebuilds it cleanly. */
  disconnect(): void {

    if (!this.socket) return;

    console.log('🔌 Disconnecting socket');

    this.socket.removeAllListeners();
    this.socket.disconnect();
    (this.socket as any) = null;
    this.plantId       = undefined;
    this.isConnecting  = false;
    this.refreshing    = false;

  }

}
