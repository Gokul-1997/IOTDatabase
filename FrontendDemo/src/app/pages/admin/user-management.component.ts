import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AdminService } from './admin.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './user-management.component.html',
  changeDetection: ChangeDetectionStrategy.Default
})
export class UserManagementComponent implements OnInit {
  users: any[] = [];
  roles: any[] = [];
  companies: any[] = [];
  loading = false;
  showCreateModal = false;
  showEditModal = false;
  selectedUser: any = null;

  createForm = {
    username: '',
    email: '',
    password: '',
    company_id: null as number | null,
    role_ids: [] as number[]
  };

  editForm = {
    username: '',
    email: '',
    password: '',
    is_active: true,
    company_id: null as number | null,
    role_ids: [] as number[]
  };

  constructor(
    private adminService: AdminService,
    private toastService: ToastService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    public auth: AuthService
  ) {}

  ngOnInit() {
    this.loadUsers();
    this.loadRoles();
  }

  loadUsers() {
    this.loading = true;
    this.cdr.detectChanges();
    this.adminService.getUsers().subscribe({
      next: res => {
        this.users = [...res];
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.toastService.error('Failed to load users');
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadRoles() {
    this.adminService.getRoles().subscribe({
      next: res => {
        this.roles = [...res];
        this.cdr.detectChanges();
      },
      error: () => this.toastService.error('Failed to load roles')
    });
  }

  loadCompanies() {
    this.adminService.getCompanies().subscribe({
      next: res => {
        this.companies = [...res];
        this.cdr.detectChanges();
      },
      error: () => this.toastService.error('Failed to load companies')
    });
  }

  openCreateModal() {
    this.createForm = { username: '', email: '', password: '', company_id: null, role_ids: [] };
    this.showCreateModal = true;
    this.cdr.detectChanges();
  }

  closeCreateModal() {
    this.showCreateModal = false;
    this.cdr.detectChanges();
  }

  isRoleSelectedForCreate(roleId: number): boolean {
    return this.createForm.role_ids.includes(roleId);
  }

  toggleRoleForCreate(roleId: number) {
    const ids = this.createForm.role_ids;
    const idx = ids.indexOf(roleId);
    this.createForm.role_ids = idx === -1 ? [...ids, roleId] : ids.filter(id => id !== roleId);
    this.cdr.detectChanges();
  }

  createUser() {
    if (!this.createForm.username.trim() || !this.createForm.email.trim() || !this.createForm.password.trim()) {
      this.toastService.error('Username, email and password are required');
      return;
    }

    this.loading = true;
    this.cdr.detectChanges();

    this.adminService.createUser(this.createForm).subscribe({
      next: () => {
        this.toastService.success('User created successfully');
        this.closeCreateModal();
        this.loadUsers();
      },
      error: err => {
        this.toastService.error(err.error?.message || 'Failed to create user');
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  openEditModal(user: any) {
    this.selectedUser = user;
    this.editForm = {
      username: user.username,
      email: user.email,
      password: '',
      is_active: user.is_active,
      company_id: user.company_id || null,
      role_ids: user.roles?.map((r: any) => r.id) || []
    };
    this.showEditModal = true;
    this.cdr.detectChanges();
  }

  closeEditModal() {
    this.showEditModal = false;
    this.selectedUser = null;
    this.cdr.detectChanges();
  }

  isRoleSelectedForEdit(roleId: number): boolean {
    return this.editForm.role_ids.includes(roleId);
  }

  toggleRoleForEdit(roleId: number) {
    const ids = this.editForm.role_ids;
    const idx = ids.indexOf(roleId);
    this.editForm.role_ids = idx === -1 ? [...ids, roleId] : ids.filter(id => id !== roleId);
    this.cdr.detectChanges();
  }

  updateUser() {
    if (!this.selectedUser) return;

    const updateData: any = {
      username: this.editForm.username,
      email: this.editForm.email,
      is_active: this.editForm.is_active
    };
    if (this.editForm.password.trim()) {
      updateData.password = this.editForm.password;
    }

    this.loading = true;
    this.cdr.detectChanges();

    const doUpdate = () => {
      this.adminService.updateUser(this.selectedUser.id, updateData).subscribe({
        next: () => {
          this.toastService.success('User updated successfully');
          this.closeEditModal();
          this.loadUsers();
        },
        error: err => {
          this.toastService.error(err.error?.message || 'Failed to update user');
          this.loading = false;
          this.cdr.detectChanges();
        }
      });
    };

    this.adminService.assignRolesToUser(this.selectedUser.id, this.editForm.role_ids).subscribe({
      next: () => doUpdate(),
      error: () => {
        this.toastService.error('Role assignment failed');
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  toggleUserActive(user: any) {
    this.loading = true;
    this.cdr.detectChanges();
    this.adminService.updateUser(user.id, { is_active: !user.is_active }).subscribe({
      next: () => {
        this.toastService.success(`User ${user.is_active ? 'deactivated' : 'activated'}`);
        this.loadUsers();
      },
      error: () => {
        this.toastService.error('Failed to update user status');
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  deleteUser(user: any) {
    if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;
    this.loading = true;
    this.cdr.detectChanges();
    this.adminService.deleteUser(user.id).subscribe({
      next: () => {
        this.toastService.success('User deleted');
        this.loadUsers();
      },
      error: () => {
        this.toastService.error('Failed to delete user');
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  getCompanyName(companyId: number): string {
    const c = this.companies.find(co => co.id === companyId);
    return c ? c.company_name : '—';
  }
}
