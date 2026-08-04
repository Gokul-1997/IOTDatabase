import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';

/**
 * Guard that checks if the user has permission to access a page.
 *
 * Permission matching:
 * - `page:dashboard` matches exactly OR any `page:dashboard:*` action (view/create/edit/delete)
 * - SNT_SUPER and COMPANY_ADMIN bypass all checks
 *
 * Usage: canActivate: [permissionGuard('page:machines')]
 */
export function permissionGuard(requiredPermission: string): CanActivateFn {
  return (route, state) => {
    const router = inject(Router);

    try {
      const userJson = localStorage.getItem('user');
      if (!userJson) {
        router.navigate(['/login']);
        return false;
      }

      const user = JSON.parse(userJson);
      const roles: string[] = user.roles || [];

      // SNT_SUPER can only access admin pages, not regular pages
      if (roles.includes('SNT_SUPER')) {
        router.navigate(['/admin/companies']);
        return false;
      }

      // COMPANY_ADMIN: can access pages their company has been granted
      if (roles.includes('COMPANY_ADMIN') || roles.includes('ADMIN')) {
        const companyPerms: string[] = user.company_permissions || [];
        // If no company permissions set yet, allow all (fresh company)
        if (companyPerms.length === 0) return true;
        // Check if company has access to this page
        if (companyPerms.includes(requiredPermission)) return true;
        if (companyPerms.some((p: string) => p.startsWith(requiredPermission + ':'))) return true;
        router.navigate(['/no-access']);
        return false;
      }

      const permissions: string[] = user.permissions || [];

      // Exact match
      if (permissions.includes(requiredPermission)) {
        return true;
      }

      // Also match if user has any CRUD action on this page
      // e.g. requiredPermission='page:machines' → match 'page:machines:view'
      const hasAnyAction = permissions.some(p => p.startsWith(requiredPermission + ':'));
      if (hasAnyAction) {
        return true;
      }

      router.navigate(['/no-access']);
      return false;
    } catch {
      router.navigate(['/login']);
      return false;
    }
  };
}
