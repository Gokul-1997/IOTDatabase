import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AdminService } from './admin.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';
import { MachinesService } from '../machines/machines.service';

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
  /** Every machine in the company — the pool a user can be made supervisor of. */
  machines: any[] = [];
  loading = false;
  showCreateModal = false;
  showEditModal = false;
  selectedUser: any = null;

  createForm = {
    username: '',
    email: '',
    password: '',
    company_id: null as number | null,
    role_ids: [] as number[],
    supervised_machine_ids: [] as number[]
  };

  editForm = {
    username: '',
    email: '',
    password: '',
    is_active: true,
    company_id: null as number | null,
    role_ids: [] as number[],
    supervised_machine_ids: [] as number[]
  };

  constructor(
    private adminService: AdminService,
    private toastService: ToastService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    public auth: AuthService,
    private machinesService: MachinesService
  ) {}

  ngOnInit() {
    this.loadUsers();
    this.loadRoles();
    this.loadMachines();
  }

  loadMachines() {
    this.machinesService.getAllForDropdown().subscribe({
      next: (res: any) => {
        this.machines = res?.data || [];
        this.cdr.detectChanges();
      },
      error: () => { /* the supervisor picker just stays empty */ }
    });
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
    this.createForm = {
      username: '', email: '', password: '', company_id: null,
      role_ids: [], supervised_machine_ids: []
    };
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

  /* ── supervised machines ──
     Which machines this user may authorise program transfers to. A setter
     or supervisor typically covers a handful out of the whole shop. */

  isMachineSelectedForCreate(machineId: number): boolean {
    return this.createForm.supervised_machine_ids.includes(machineId);
  }

  toggleMachineForCreate(machineId: number) {
    const ids = this.createForm.supervised_machine_ids;
    const idx = ids.indexOf(machineId);
    this.createForm.supervised_machine_ids = idx === -1 ? [...ids, machineId] : ids.filter(id => id !== machineId);
    this.cdr.detectChanges();
  }

  isMachineSelectedForEdit(machineId: number): boolean {
    return this.editForm.supervised_machine_ids.includes(machineId);
  }

  toggleMachineForEdit(machineId: number) {
    const ids = this.editForm.supervised_machine_ids;
    const idx = ids.indexOf(machineId);
    this.editForm.supervised_machine_ids = idx === -1 ? [...ids, machineId] : ids.filter(id => id !== machineId);
    this.cdr.detectChanges();
  }


  /* ── role selection ──────────────────────────────────────────
     One role per user, chosen from a dropdown. role_ids stays an array
     because that is what the API takes; the UI just never puts more than
     one id in it. */

  private formFor(kind: 'Create' | 'Edit') {
    return kind === 'Create' ? this.createForm : this.editForm;
  }

  selectedRoleId(kind: 'Create' | 'Edit'): number | null {
    return this.formFor(kind).role_ids[0] ?? null;
  }

  setRole(kind: 'Create' | 'Edit', roleId: number | null) {
    const form = this.formFor(kind);
    form.role_ids = roleId == null ? [] : [roleId];

    // Dropping to a role that cannot reach a controller should not leave a
    // machine assignment behind that nothing in the UI shows any more.
    if (!this.roleNeedsMachines(kind)) form.supervised_machine_ids = [];
    this.cdr.detectChanges();
  }

  /**
   * Whether the chosen role can send programs to a machine.
   *
   * Read from the role's own permissions rather than a name like
   * "SUPERVISOR": companies create their own roles, so a name match would
   * miss a role called "Setter" or "Line Lead". getRoles() already returns
   * each role with its permission list, so no extra request is needed.
   */
  roleNeedsMachines(kind: 'Create' | 'Edit'): boolean {
    const role = this.roles.find(r => r.id === this.selectedRoleId(kind));
    const keys: string[] = (role?.permissions || []).map((p: any) => p.permission_key);
    return keys.includes('page:programs:transfer');
  }

  /** One line under the dropdown saying what the choice actually means. */
  roleSummary(kind: 'Create' | 'Edit'): string {
    const role = this.roles.find(r => r.id === this.selectedRoleId(kind));
    if (!role) return 'Pick the role that matches what this person does.';
    if (this.roleNeedsMachines(kind)) {
      return `${role.role_name} can send programs to a machine, so choose which machines below.`;
    }
    return `${role.role_name} cannot send programs to a machine, so no machine assignment is needed.`;
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
      role_ids: user.roles?.map((r: any) => r.id) || [],
      supervised_machine_ids: []
    };
    this.showEditModal = true;
    this.cdr.detectChanges();

    // The list endpoint doesn't carry supervised machines, so tick the
    // boxes once the detail arrives rather than holding the modal shut.
    this.adminService.getUserById(user.id).subscribe({
      next: (res: any) => {
        const detail = res?.data || res;
        this.editForm.supervised_machine_ids = detail?.supervised_machine_ids || [];
        this.cdr.detectChanges();
      },
      error: () => { /* leave the boxes unticked; saving still works */ }
    });
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
      is_active: this.editForm.is_active,
      supervised_machine_ids: this.editForm.supervised_machine_ids
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
