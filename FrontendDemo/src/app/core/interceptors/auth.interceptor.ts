import {
  HttpRequest,
  HttpHandlerFn,
  HttpEvent,
  HttpErrorResponse,
  HttpInterceptorFn
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, filter, take, switchMap, tap } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

let isRefreshing = false;
const refreshTokenSubject = new BehaviorSubject<string | null>(null);

export const AuthInterceptor: HttpInterceptorFn = (req, next) => {

  const authService = inject(AuthService);

  // Skip auth endpoints — no token needed
  if (req.url.includes('/auth/refresh') || req.url.includes('/auth/login') || req.url.includes('/auth/forgot-password') || req.url.includes('/auth/reset-password')) {
    return next(req);
  }

  const token = localStorage.getItem('token');

  if (token) {
    req = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {

      if (error.status !== 401) {
        return throwError(() => error);
      }

      if (!isRefreshing) {
        isRefreshing = true;
        refreshTokenSubject.next(null);

        return authService.refreshToken().pipe(
          switchMap((res: any) => {
            isRefreshing = false;

            const newToken = res.accessToken;
            refreshTokenSubject.next(newToken);

            return next(
              req.clone({
                setHeaders: {
                  Authorization: `Bearer ${newToken}`
                }
              })
            );
          }),
          catchError((refreshErr) => {
            isRefreshing = false;
            refreshTokenSubject.next(null); // unblock any queued requests so they can fail
            authService.logout();
            return throwError(() => refreshErr);
          })
        );
      }

      return refreshTokenSubject.pipe(
        filter(token => token != null),
        take(1),
        switchMap(token =>
          next(
            req.clone({
              setHeaders: {
                Authorization: `Bearer ${token}`
              }
            })
          )
        )
      );
    })
  );
};