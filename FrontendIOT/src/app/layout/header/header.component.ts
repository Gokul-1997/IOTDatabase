import { Component, HostListener, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { IconComponent } from '../../shared/icon/icon';
import { AuthService } from '../../core/services/auth.service';
// import { NotificationBellComponent } from '../../shared/notification-bell/notification-bell.component';

@Component({
  standalone: true,
  selector: 'app-header',
  imports: [CommonModule, RouterModule, IconComponent],
  templateUrl: './header.component.html',
})
export class HeaderComponent implements OnInit {

  openMenu: string | null = null;
  isDark = false;
  showUserMenu = false;
  userName = 'Admin';
  userEmail = '';
  userRole = '';
  companyName = '';
  planName = '';

  isAdmin = false;
  isSntSuper = false;

  // All menus with permission keys for filtering
  /*
   * Grouped deliberately. This was a flat list of fourteen top-level items,
   * which no longer fitted the header: seven of them — Settings and Admin
   * among them — sat outside the visible area with no scrollbar to hint at
   * it, so they simply looked missing.
   *
   * Four dashboards and four analytics pages are the natural groups, and
   * both sets already share a permission, so grouping costs nothing in
   * access control and takes the bar from fourteen items to eight.
   */
  allMenus: any[] = [
    {
      label: 'Dashboards', icon: 'dashnew',
      children: [
        { label: 'Live Dashboard', path: '/dashboard', permission: 'page:dashboard' },
        { label: 'Factory Overall', path: '/factory', permission: 'page:dashboard' },
        { label: 'Maintenance', path: '/maintenance-dashboard', permission: 'page:dashboard' },
        { label: 'Preventive', path: '/preventive-maintenance', permission: 'page:dashboard' },
        { label: 'Periodic', path: '/periodic-maintenance', permission: 'page:dashboard' },
        { label: 'Alarms', path: '/alarm-report', permission: 'page:dashboard' },
        { label: 'Downtime', path: '/downtime-analysis', permission: 'page:dashboard' },
        { label: 'Operators', path: '/operator-performance', permission: 'page:dashboard' },
        { label: 'OEE', path: '/oee-dashboard', permission: 'page:dashboard' },
        { label: 'Energy', path: '/energy-dashboard', permission: 'page:dashboard' }
      ]
    },
    {
      label: 'Analytics', icon: 'donutnew',
      children: [
        { label: 'OEE', path: '/oee-reports', permission: 'page:oee-reports' },
        { label: 'Reports', path: '/reports', permission: 'page:reports' },
        { label: 'Charts', path: '/charts', permission: 'page:charts' },
        { label: 'Quality', path: '/quality', permission: 'page:quality' }
      ]
    },
    { label: 'Alarms', path: '/alarms', icon: 'alerts', permission: 'page:alarms' },
    { label: 'Downtime', path: '/downtime', icon: 'downtime', permission: 'page:downtime' },
    { label: 'Maintenance', path: '/maintenance', icon: 'maintenance', permission: 'page:maintenance' },
    { label: 'Production Plans', path: '/production-plans', icon: 'plans', permission: 'page:production-plans' },
    {
      label: 'Settings', icon: 'gearnew',
      children: [
        { label: 'Machines', path: '/machines', permission: 'page:machines' },
        { label: 'Program Transfer', path: '/programs', permission: 'page:machines' },
        { label: 'Component', path: '/component', permission: 'page:component' },
        { label: 'Job', path: '/job', permission: 'page:job' },
        { label: 'Lines', path: '/lines', permission: 'page:lines' },
        { label: 'Shifts', path: '/shifts', permission: 'page:shifts' },
        { label: 'Operators', path: '/operators', permission: 'page:operators' },
        { label: '2FA Security', path: '/security/2fa', permission: 'page:security' }
      ]
    },
    { label: 'Admin', path: '/admin/users', icon: 'shield', adminOnly: true } 
  ];

  menus: any[] = [];

  constructor(
    private router: Router,
    private auth: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  /*
   * The app runs zoneless (Angular 21, no zone.js). Flipping openMenu or
   * showUserMenu schedules no render on its own, so both header dropdowns
   * changed state and never appeared — the Settings menu looked missing and
   * the user menu did nothing. Every handler that changes them has to say so.
   */
  private touch() { this.cdr.markForCheck(); }

  ngOnInit() {
    const user = this.auth.getUser();
    this.userName    = user.username || user.company_name || 'Admin';
    this.userEmail   = user.email || '';
    this.isSntSuper  = this.auth.isSntSuper();
    this.isAdmin     = this.auth.isAdmin();
    this.userRole    = user.user_type === 'snt_super' ? 'S&T Super Admin'
                     : user.roles?.includes('COMPANY_ADMIN') ? 'Company Admin'
                     : user.roles?.[0] || 'User';
    this.planName    = user.plan?.plan_name || '';
    this.companyName = user.company_name || '';

    // SNT_SUPER: show Companies as the admin landing
    if (this.isSntSuper) {
      this.allMenus = this.allMenus.map(m =>
        m.adminOnly ? { ...m, label: 'Admin', path: '/admin/companies' } : m
      );
    }

    this.buildMenus();
  }

  buildMenus() {
    // SNT_SUPER only sees Admin pages — no dashboard/reports/master
    if (this.isSntSuper) {
      this.menus = this.allMenus.filter(m => m.adminOnly);
      return;
    }

    this.menus = this.allMenus
      .map(menu => {
        if (menu.adminOnly) return this.isAdmin ? menu : null;

        if (menu.children) {
          const filteredChildren = menu.children.filter((child: any) =>
            this.auth.hasPermission(child.permission)
          );
          return filteredChildren.length > 0 ? { ...menu, children: filteredChildren } : null;
        }

        return this.auth.hasPermission(menu.permission) ? menu : null;
      })
      .filter(m => m !== null);
  }

  toggleUserMenu() { this.showUserMenu = !this.showUserMenu; this.touch(); }

  logout() {
    this.showUserMenu = false;
    this.auth.logout();
  }

  toggleMenu(label: string) { this.openMenu = this.openMenu === label ? null : label; this.touch(); }
  closeMenu() { this.openMenu = null; this.touch(); }

  navigate(menu: any) {
    this.router.navigate([menu.path]);
    this.closeMenu();
  }

  isActive(path: string) { return this.router.url.startsWith(path); }
  isChildActive(children: any[]) { return children?.some(c => this.router.url.startsWith(c.path)); }

  toggleTheme() {
    this.isDark = !this.isDark;
    this.touch();
    document.documentElement.classList.toggle('dark', this.isDark);
  }

  isMobileMenuOpen = false;
  toggleMobileMenu() { this.isMobileMenuOpen = !this.isMobileMenuOpen; this.touch(); }

  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const before = `${this.openMenu}|${this.showUserMenu}`;
    if (!target.closest('nav'))             this.openMenu     = null;
    if (!target.closest('.user-menu-wrap')) this.showUserMenu = false;
    // only repaint when something actually closed
    if (before !== `${this.openMenu}|${this.showUserMenu}`) this.touch();
  }

  @HostListener('document:keydown.escape')
  onEsc() { this.openMenu = null; this.showUserMenu = false; this.touch(); }
}
