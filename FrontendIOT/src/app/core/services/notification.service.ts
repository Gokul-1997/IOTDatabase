import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, interval } from 'rxjs';
import { switchMap, startWith } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private api = environment.apiUrl + '/notifications';
  unreadCount$ = new BehaviorSubject<number>(0);

  constructor(private http: HttpClient) {
    // Poll unread count every 30 seconds
    interval(30000).pipe(startWith(0), switchMap(() => this.http.get<any>(`${this.api}/unread-count`))).subscribe({
      next: res => this.unreadCount$.next(res.count || 0),
      error: () => {}
    });
  }

  getNotifications(params: any = {}) {
    return this.http.get<any>(this.api, { params });
  }

  markRead(id: number) {
    return this.http.patch(`${this.api}/${id}/read`, {});
  }

  markAllRead() {
    return this.http.post(`${this.api}/mark-all-read`, {}).pipe();
  }
}
