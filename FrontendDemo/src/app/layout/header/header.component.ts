import { Component, HostListener, OnInit } from '@angular/core';
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
  allMenus: any[] = [
    { label: 'Dashboard', path: '/dashboard', icon: 'dashnew', permission: 'page:dashboard' },
    { label: 'OEE', path: '/oee-reports', icon: 'donutnew', permission: 'page:oee-reports' },
    { label: 'Reports', path: '/reports', icon: 'reportnew', permission: 'page:reports' },
    { label: 'Charts', path: '/charts', icon: 'chartnew', permission: 'page:charts' },
    { label: 'Quality', path: '/quality', icon: 'dropnew', permission: 'page:quality' },
    { label: 'Alarms', path: '/alarms', icon: 'alerts', permission: 'page:alarms' },
    { label: 'Downtime', path: '/downtime', icon: 'downtime', permission: 'page:downtime' },
    { label: 'Maintenance', path: '/maintenance', icon: 'maintenance', permission: 'page:maintenance' },
    { label: 'Production Plans', path: '/production-plans', icon: 'plans', permission: 'page:production-plans' },
    {
      label: 'Settings', icon: 'gearnew',
      children: [
        { label: 'Machines', path: '/machines', permission: 'page:machines' },
        { label: 'Component', path: '/component', permission: 'page:component' },
        { label: 'Job', path: '/job', permission: 'page:job' },
        { label: 'Lines', path: '/lines', permission: 'page:lines' },
        { label: 'Shifts', path: '/shifts', permission: 'page:shifts' },
        { label: 'Operators', path: '/operators', permission: 'page:operators' },
        { label: '2FA Security', path: '/security/2fa', permission: 'page:security' }
      ]
    },
    // { label: 'Admin', path: '/admin/users', icon: 'shield', adminOnly: true } 
  ];

  menus: any[] = [];

  constructor(private router: Router, private auth: AuthService) {}

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

  toggleUserMenu() { this.showUserMenu = !this.showUserMenu; }

  logout() {
    this.showUserMenu = false;
    this.auth.logout();
  }

  toggleMenu(label: string) { this.openMenu = this.openMenu === label ? null : label; }
  closeMenu() { this.openMenu = null; }

  navigate(menu: any) {
    this.router.navigate([menu.path]);
    this.closeMenu();
  }

  isActive(path: string) { return this.router.url.startsWith(path); }
  isChildActive(children: any[]) { return children?.some(c => this.router.url.startsWith(c.path)); }

  toggleTheme() {
    this.isDark = !this.isDark;
    document.documentElement.classList.toggle('dark', this.isDark);
  }

  isMobileMenuOpen = false;
  toggleMobileMenu() { this.isMobileMenuOpen = !this.isMobileMenuOpen; }

  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('nav'))            this.openMenu    = null;
    if (!target.closest('.user-menu-wrap')) this.showUserMenu = false;
  }

  @HostListener('document:keydown.escape')
  onEsc() { this.openMenu = null; }
}
