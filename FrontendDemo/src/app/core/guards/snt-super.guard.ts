import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';

export const sntSuperGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);

  try {
    const userJson = localStorage.getItem('user');
    if (!userJson) {
      router.navigate(['/login']);
      return false;
    }

    const user = JSON.parse(userJson);
    const roles: string[] = user.roles || [];

    if (roles.includes('SNT_SUPER')) {
      return true;
    }

    router.navigate(['/admin/users']);
    return false;
  } catch {
    router.navigate(['/login']);
    return false;
  }
};
