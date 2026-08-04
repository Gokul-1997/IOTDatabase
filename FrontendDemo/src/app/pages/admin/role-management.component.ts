import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AdminService } from './admin.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-role-management',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './role-management.component.html',
  changeDetection: ChangeDetectionStrategy.Default
})
export class RoleManagementComponent implements OnInit {
  roles: any[] = [];
  permissionModules: any[] = [];  // [{module, label, group, permissions: [{id, permission_key, action}]}]
  permissionGroups: string[] = [];
  loading = false;
  showCreateModal = false;
  showPagesModal = false;
  selectedRole: any = null;
  seeding = false;

  createForm = { role_name: '' };
  selectedPermIds: Set<number> = new Set();

  constructor(
    private adminService: AdminService,
    private toastService: ToastService,
    private cdr: ChangeDetectorRef,
    public auth: AuthService
  ) {}

  ngOnInit() {
    this.loadRoles();
    this.loadPermissions();
  }

  loadRoles() {
    this.loading = true;
    this.cdr.detectChanges();
    this.adminService.getRoles().subscribe({
      next: res => {
        this.roles = [...res];
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.toastService.error('Failed to load roles');
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadPermissions() {
    this.adminService.getPagePermissions().subscribe({
      next: res => {
        this.permissionModules = [...res];
        this.permissionGroups = [...new Set(res.map((m: any) => m.group))] as string[];
        this.cdr.detectChanges();
      },
      error: () => this.toastService.error('Failed to load permissions')
    });
  }

  seedPages() {
    this.seeding = true;
    this.cdr.detectChanges();
    this.adminService.seedPagePermissions().subscribe({
      next: () => {
        this.toastService.success('Page permissions seeded successfully');
        this.seeding = false;
        this.loadPermissions();
      },
      error: () => {
        this.toastService.error('Failed to seed page permissions');
        this.seeding = false;
        this.cdr.detectChanges();
      }
    });
  }

  getModulesByGroup(group: string): any[] {
    return this.permissionModules.filter(m => m.group === group);
  }

  // ── Create Role ──
  openCreateModal() {
    this.createForm = { role_name: '' };
    this.showCreateModal = true;
    this.cdr.detectChanges();
  }

  closeCreateModal() {
    this.showCreateModal = false;
    this.cdr.detectChanges();
  }

  createRole() {
    if (!this.createForm.role_name.trim()) {
      this.toastService.error('Role name is required');
      return;
    }
    this.loading = true;
    this.cdr.detectChanges();
    this.adminService.createRole(this.createForm).subscribe({
      next: () => {
        this.toastService.success('Role created successfully');
        this.closeCreateModal();
        this.loadRoles();
      },
      error: err => {
        this.toastService.error(err.error?.message || 'Failed to create role');
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ── Permission Assignment Modal ──
  openPagesModal(role: any) {
    this.selectedRole = role;
    this.selectedPermIds = new Set(
      (role.permissions || [])
        .filter((p: any) => p.permission_key?.startsWith('page:'))
        .map((p: any) => p.id)
    );
    this.showPagesModal = true;
    this.cdr.detectChanges();
  }

  closePagesModal() {
    this.showPagesModal = false;
    this.selectedRole = null;
    this.selectedPermIds = new Set();
    this.cdr.detectChanges();
  }

  isPermSelected(permId: number): boolean {
    return this.selectedPermIds.has(permId);
  }

  togglePerm(permId: number) {
    const s = new Set(this.selectedPermIds);
    s.has(permId) ? s.delete(permId) : s.add(permId);
    this.selectedPermIds = s;
    this.cdr.detectChanges();
  }

  toggleModule(mod: any) {
    const s = new Set(this.selectedPermIds);
    const allSelected = mod.permissions.every((p: any) => s.has(p.id));
    mod.permissions.forEach((p: any) => allSelected ? s.delete(p.id) : s.add(p.id));
    this.selectedPermIds = s;
    this.cdr.detectChanges();
  }

  isModuleAllSelected(mod: any): boolean {
    return mod.permissions.length > 0 && mod.permissions.every((p: any) => this.selectedPermIds.has(p.id));
  }

  isModulePartial(mod: any): boolean {
    const count = mod.permissions.filter((p: any) => this.selectedPermIds.has(p.id)).length;
    return count > 0 && count < mod.permissions.length;
  }

  toggleGroup(group: string) {
    const mods = this.getModulesByGroup(group);
    const s = new Set(this.selectedPermIds);
    const allSelected = mods.every(m => m.permissions.every((p: any) => s.has(p.id)));
    mods.forEach(m => m.permissions.forEach((p: any) => allSelected ? s.delete(p.id) : s.add(p.id)));
    this.selectedPermIds = s;
    this.cdr.detectChanges();
  }

  isGroupAllSelected(group: string): boolean {
    const mods = this.getModulesByGroup(group);
    return mods.every(m => m.permissions.every((p: any) => this.selectedPermIds.has(p.id)));
  }

  isGroupPartial(group: string): boolean {
    const mods = this.getModulesByGroup(group);
    const allPerms = mods.flatMap(m => m.permissions);
    const count = allPerms.filter((p: any) => this.selectedPermIds.has(p.id)).length;
    return count > 0 && count < allPerms.length;
  }

  savePageAccess() {
    if (!this.selectedRole) return;
    // Keep non-page permissions, add selected page permissions
    const nonPagePermIds = (this.selectedRole.permissions || [])
      .filter((p: any) => !p.permission_key?.startsWith('page:'))
      .map((p: any) => p.id);
    const allPermIds = [...nonPagePermIds, ...Array.from(this.selectedPermIds)];
    this.loading = true;
    this.cdr.detectChanges();
    this.adminService.assignPermissionsToRole(this.selectedRole.id, allPermIds).subscribe({
      next: () => {
        this.toastService.success('Permissions updated successfully');
        this.closePagesModal();
        this.loadRoles();
      },
      error: err => {
        this.toastService.error(err.error?.message || 'Failed to update permissions');
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ── Delete ──
  deleteRole(role: any) {
    if (!confirm(`Delete role "${role.role_name}"? This cannot be undone.`)) return;
    this.loading = true;
    this.cdr.detectChanges();
    this.adminService.deleteRole(role.id).subscribe({
      next: () => {
        this.toastService.success('Role deleted');
        this.loadRoles();
      },
      error: () => {
        this.toastService.error('Failed to delete role');
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ── Helpers ──
  getPageNames(role: any): string {
    const pages = (role.permissions || []).filter((p: any) => p.permission_key?.startsWith('page:'));
    if (!pages.length) return '';
    // Group by module and show unique module names
    const moduleSet = new Set<string>();
    pages.forEach((p: any) => moduleSet.add(p.permission_key.split(':')[1]));
    return Array.from(moduleSet).map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(', ');
  }

  getPageCount(role: any): number {
    // Count unique modules (not individual actions)
    const modules = new Set(
      (role.permissions || [])
        .filter((p: any) => p.permission_key?.startsWith('page:'))
        .map((p: any) => p.permission_key.split(':')[1])
    );
    return modules.size;
  }

  getActionCount(role: any): number {
    return (role.permissions || []).filter((p: any) => p.permission_key?.startsWith('page:')).length;
  }
}
