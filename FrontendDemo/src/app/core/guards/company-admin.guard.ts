import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';

/**
 * Blocks SNT_SUPER from accessing company-admin-only pages (Users, Roles).
 * SNT_SUPER is redirected to /admin/companies.
 * COMPANY_ADMIN and ADMIN are allowed through.
 */
export const companyAdminGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);

  try {
    const userJson = localStorage.getItem('user');
    if (!userJson) {
      router.navigate(['/login']);
      return false;
    }

    const user = JSON.parse(userJson);
    const roles: string[] = user.roles || [];

    // SNT_SUPER cannot access users/roles — redirect to companies
    if (roles.includes('SNT_SUPER')) {
      router.navigate(['/admin/companies']);
      return false;
    }

    // COMPANY_ADMIN or ADMIN can access
    if (roles.includes('COMPANY_ADMIN') || roles.includes('ADMIN')) {
      return true;
    }

    router.navigate(['/dashboard']);
    return false;
  } catch {
    router.navigate(['/login']);
    return false;
  }
};
