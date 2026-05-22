import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';
import { sntSuperGuard } from './core/guards/snt-super.guard';
import { companyAdminGuard } from './core/guards/company-admin.guard';
import { permissionGuard } from './core/guards/permission.guard';

export const routes: Routes = [

  // PUBLIC ROUTES
  { path: 'login', loadComponent: () => import('./pages/auth/login.component').then(m => m.LoginComponent) },
  { path: 'forgot-password', loadComponent: () => import('./pages/forgot/forgot-password.component').then(m => m.ForgotPasswordComponent) },
  { path: 'reset-password/:token', loadComponent: () => import('./pages/forgot/reset-password.component').then(m => m.ResetPasswordComponent) },

  // PROTECTED ROUTES (WITH SIDEBAR)
  {
    path: '',
    loadComponent: () => import('./layout/main-layout/main-layout').then(m => m.MainLayoutComponent),
    canActivate: [authGuard],
    children: [

      { path: 'dashboard', canActivate: [permissionGuard('page:dashboard')], loadComponent: () => import('./pages/dashboard/dashboard.component').then(m => m.DashboardComponent) },
      { path: 'dashboard/live/:id', canActivate: [permissionGuard('page:dashboard:live')], loadComponent: () => import('./pages/dashboard/live/live.component').then(m => m.LiveComponent) },

      { path: 'component', canActivate: [permissionGuard('page:component')], loadComponent: () => import('./pages/component/component_list.component').then(m => m.ComponentList) },

      { path: 'machines', canActivate: [permissionGuard('page:machines')], loadComponent: () => import('./pages/machines/machines.component').then(m => m.MachinesComponent) },
      { path: 'machines/create', canActivate: [permissionGuard('page:machines')], loadComponent: () => import('./pages/machines/machine-form.component').then(m => m.MachineFormComponent) },

      { path: 'shifts', canActivate: [permissionGuard('page:shifts')], loadComponent: () => import('./pages/shifts/shifts.component').then(m => m.ShiftsComponent) },
      { path: 'shifts/create', canActivate: [permissionGuard('page:shifts')], loadComponent: () => import('./pages/shifts/shift-form.component').then(m => m.ShiftFormComponent) },

      { path: 'operators', canActivate: [permissionGuard('page:operators')], loadComponent: () => import('./pages/operators/operators.component').then(m => m.OperatorsComponent) },
      { path: 'operators/create', canActivate: [permissionGuard('page:operators')], loadComponent: () => import('./pages/operators/operator-form.component').then(m => m.OperatorFormComponent) },

      { path: 'assignments', canActivate: [permissionGuard('page:assignments')], loadComponent: () => import('./pages/assignments/assignment.component').then(m => m.AssignmentComponent) },
      { path: 'assignments/operator-shift', canActivate: [permissionGuard('page:assignments')], loadComponent: () => import('./pages/assignments/operator-shift.component').then(m => m.OperatorShiftComponent) },

      { path: 'machine-shifts', canActivate: [permissionGuard('page:machine-shifts')], loadComponent: () => import('./pages/machine-shifts/machine-shift.component').then(m => m.MachineShiftComponent) },

      { path: 'plants', canActivate: [permissionGuard('page:plants')], loadComponent: () => import('./pages/plants/plants.component').then(m => m.PlantsComponent) },
      { path: 'plants/create', canActivate: [permissionGuard('page:plants')], loadComponent: () => import('./pages/plants/plant-form.component').then(m => m.PlantFormComponent) },

      { path: 'lines', canActivate: [permissionGuard('page:lines')], loadComponent: () => import('./pages/lines/lines.component').then(m => m.LinesComponent) },

      { path: 'reports', canActivate: [permissionGuard('page:reports')], loadComponent: () => import('./pages/reports/reports').then(m => m.Reports) },
      { path: 'oee-reports', canActivate: [permissionGuard('page:oee-reports')], loadComponent: () => import('./pages/oee-reports/oee-reports').then(m => m.OeeReportsComponent) },
      { path: 'charts', canActivate: [permissionGuard('page:charts')], loadComponent: () => import('./pages/charts/charts').then(m => m.Charts) },
      { path: 'quality', canActivate: [permissionGuard('page:quality')], loadComponent: () => import('./pages/quality/quality').then(m => m.Quality) },
      { path: 'job', canActivate: [permissionGuard('page:job')], loadComponent: () => import('./pages/job/job-list.component').then(m => m.JobListComponent) },

      { path: 'alarms', loadComponent: () => import('./pages/alarms/alarms.component').then(m => m.AlarmsComponent) },
      { path: 'downtime', loadComponent: () => import('./pages/downtime/downtime.component').then(m => m.DowntimeComponent) },
      { path: 'maintenance', loadComponent: () => import('./pages/maintenance/maintenance.component').then(m => m.MaintenanceComponent) },
      { path: 'production-plans', loadComponent: () => import('./pages/production-plans/production-plans.component').then(m => m.ProductionPlansComponent) },
      { path: 'security/2fa', loadComponent: () => import('./pages/security/twofa-setup.component').then(m => m.TwofaSetupComponent) },

      // ADMIN ROUTES (SNT_SUPER / COMPANY_ADMIN / ADMIN)
      {
        path: 'admin',
        canActivate: [adminGuard],
        children: [
          { path: 'companies', canActivate: [sntSuperGuard], loadComponent: () => import('./pages/admin/company-management.component').then(m => m.CompanyManagementComponent) },
          { path: 'users', canActivate: [companyAdminGuard], loadComponent: () => import('./pages/admin/user-management.component').then(m => m.UserManagementComponent) },
          { path: 'roles', canActivate: [companyAdminGuard], loadComponent: () => import('./pages/admin/role-management.component').then(m => m.RoleManagementComponent) },
          { path: '', redirectTo: 'users', pathMatch: 'full' }
        ]
      },

      // NO ACCESS
      { path: 'no-access', loadComponent: () => import('./pages/no-access/no-access.component').then(m => m.NoAccessComponent) },

      // DEFAULT
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
    ]
  },

  // FALLBACK
  { path: '**', redirectTo: 'login' }
];
