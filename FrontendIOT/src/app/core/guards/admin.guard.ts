import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';

export const adminGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);

  try {
    const userJson = localStorage.getItem('user');
    if (!userJson) {
      router.navigate(['/login']);
      return false;
    }

    const user = JSON.parse(userJson);
    const roles: string[] = user.roles || [];

    // SNT_SUPER, COMPANY_ADMIN, or legacy ADMIN all get admin access
    if (roles.includes('SNT_SUPER') || roles.includes('COMPANY_ADMIN') || roles.includes('ADMIN')) {
      return true;
    }

    router.navigate(['/dashboard']);
    return false;
  } catch {
    router.navigate(['/login']);
    return false;
  }
};
