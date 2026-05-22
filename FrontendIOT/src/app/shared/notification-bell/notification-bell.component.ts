import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NotificationService } from '../../core/services/notification.service';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="relative">
      <button (click)="togglePanel()" class="relative p-2 text-gray-600 hover:text-blue-600 transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.437L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        <span *ngIf="(notifService.unreadCount$ | async) as count"
          class="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full">
          {{ count > 99 ? '99+' : count }}
        </span>
      </button>

      <div *ngIf="open" class="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border border-gray-100 z-50">
        <div class="flex items-center justify-between p-4 border-b">
          <h3 class="font-semibold text-gray-800">Notifications</h3>
          <button (click)="markAllRead()" class="text-xs text-blue-600 hover:underline">Mark all read</button>
        </div>
        <div class="max-h-80 overflow-y-auto divide-y divide-gray-50">
          <ng-container *ngIf="notifications.length > 0; else noNotifs">
            <div *ngFor="let n of notifications"
              class="flex items-start gap-3 p-3 cursor-pointer transition-colors"
              [class.bg-blue-50]="!n.is_read"
              (click)="onRead(n)">
              <div class="flex-shrink-0 mt-1">
                <div *ngIf="n.type === 'ALARM'" class="w-2 h-2 rounded-full bg-red-500"></div>
                <div *ngIf="n.type === 'WARNING'" class="w-2 h-2 rounded-full bg-yellow-500"></div>
                <div *ngIf="n.type !== 'ALARM' && n.type !== 'WARNING'" class="w-2 h-2 rounded-full bg-blue-500"></div>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-gray-800 truncate">{{ n.title }}</p>
                <p class="text-xs text-gray-500 mt-0.5">{{ n.message }}</p>
                <p class="text-xs text-gray-400 mt-1">{{ n.created_at | date:'short' }}</p>
              </div>
            </div>
          </ng-container>
          <ng-template #noNotifs>
            <div class="p-6 text-center text-gray-400 text-sm">No notifications</div>
          </ng-template>
        </div>
        <div class="p-3 border-t text-center">
          <a routerLink="/notifications" class="text-xs text-blue-600 hover:underline" (click)="open=false">View all</a>
        </div>
      </div>
    </div>
  `
})
export class NotificationBellComponent implements OnInit {
  open = false;
  notifications: any[] = [];

  constructor(public notifService: NotificationService) {}

  ngOnInit() { this.load(); }

  load() {
    this.notifService.getNotifications({ limit: 10 }).subscribe({
      next: res => this.notifications = res.data || [],
      error: () => {}
    });
  }

  togglePanel() {
    this.open = !this.open;
    if (this.open) this.load();
  }

  onRead(n: any) {
    if (!n.is_read) {
      this.notifService.markRead(n.id).subscribe();
      n.is_read = true;
      const count = this.notifService.unreadCount$.value;
      if (count > 0) this.notifService.unreadCount$.next(count - 1);
    }
  }

  markAllRead() {
    this.notifService.markAllRead().subscribe({
      next: () => { this.notifications.forEach(n => n.is_read = true); this.notifService.unreadCount$.next(0); }
    });
  }
}
