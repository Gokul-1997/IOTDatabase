import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { CompanyService } from '../../core/services/company.service';
import { ToastService } from '../../core/services/toast.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-company-management',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './company-management.component.html',
})
export class CompanyManagementComponent implements OnInit {
  companies: any[] = [];
  plans: any[] = [];
  loading = false;

  // Create/Edit modal
  showModal = false;
  isEditing = false;
  form: any = { company_code: '', company_name: '', contact_email: '', contact_phone: '', address: '' };
  editId: number | null = null;

  // Plan modal
  showPlanModal = false;
  selectedCompany: any = null;
  planForm = { plan_id: 0, max_users: null as number | null, max_plants: null as number | null, max_machines: null as number | null };

  // ── Plants modal
  showPlantsModal = false;
  plantsCompany:  any    = null;
  plants:         any[]  = [];
  plantsLoading          = false;
  plantsError            = '';
  showPlantForm          = false;
  plantFormData:  any    = null;
  plantForm       = { plant_code: '', plant_name: '', location: '' };
  plantFormSaving        = false;
  plantFormError         = '';

  // Detail modal
  showDetailModal = false;
  detailCompany: any = null;

  // ── Page Access Modal ──
  showAccessModal = false;
  accessCompany: any = null;
  allPermissions: any[] = [];       // all permissions grouped by module
  companyPermIds: Set<number> = new Set();  // selected permission IDs
  accessLoading = false;

  constructor(
    private companyService: CompanyService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef,
    public auth: AuthService
  ) {}

  ngOnInit() {
    this.loadCompanies();
    this.loadPlans();
  }

  loadCompanies() {
    this.loading = true;
    this.companyService.getCompanies().subscribe({
      next: res => { this.companies = res; this.loading = false; this.cdr.detectChanges(); },
      error: () => { this.toast.error('Failed to load companies'); this.loading = false; this.cdr.detectChanges(); }
    });
  }

  loadPlans() {
    this.companyService.getPlans().subscribe({
      next: res => { this.plans = res; this.cdr.detectChanges(); },
      error: () => this.toast.error('Failed to load plans')
    });
  }

  // ── Create / Edit ──────────────────────────────
  openCreateModal() {
    this.isEditing = false;
    this.editId = null;
    this.form = {
      company_code: '', company_name: '', contact_email: '', contact_phone: '', address: '',
      admin_username: '', admin_email: ''
    };
    this.showModal = true;
    this.cdr.detectChanges();
  }

  openEditModal(company: any) {
    this.isEditing = true;
    this.editId = company.id;
    this.form = {
      company_code: company.company_code,
      company_name: company.company_name,
      contact_email: company.contact_email || '',
      contact_phone: company.contact_phone || '',
      address: company.address || ''
    };
    this.showModal = true;
    this.cdr.detectChanges();
  }

  closeModal() {
    this.showModal = false;
    this.cdr.detectChanges();
  }

  saveCompany() {
    if (!this.form.company_code?.trim() || !this.form.company_name?.trim()) {
      this.toast.error('Company code and name are required');
      return;
    }
    // On create, require admin user details
    if (!this.isEditing) {
      if (!this.form.admin_username?.trim() || !this.form.admin_email?.trim()) {
        this.toast.error('Admin username and email are required');
        return;
      }
    }
    this.loading = true;
    this.cdr.detectChanges();

    const obs = this.isEditing
      ? this.companyService.updateCompany(this.editId!, this.form)
      : this.companyService.createCompany(this.form);

    obs.subscribe({
      next: () => {
        this.toast.success(this.isEditing ? 'Company updated' : 'Company created with admin user');
        this.closeModal();
        this.loadCompanies();
      },
      error: err => {
        this.toast.error(err.error?.message || 'Failed to save company');
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ── Plan Assignment ────────────────────────────
  openPlanModal(company: any) {
    this.selectedCompany = company;
    this.planForm = {
      plan_id: company.plan_id || (this.plans[0]?.id || 0),
      max_users: null,
      max_plants: null,
      max_machines: null
    };
    this.showPlanModal = true;
    this.cdr.detectChanges();
  }

  closePlanModal() {
    this.showPlanModal = false;
    this.selectedCompany = null;
    this.cdr.detectChanges();
  }

  assignPlan() {
    if (!this.planForm.plan_id) {
      this.toast.error('Select a plan');
      return;
    }
    this.loading = true;
    this.cdr.detectChanges();
    this.companyService.assignPlan(this.selectedCompany.id, this.planForm).subscribe({
      next: () => {
        this.toast.success('Plan assigned successfully');
        this.closePlanModal();
        this.loadCompanies();
      },
      error: err => {
        this.toast.error(err.error?.message || 'Failed to assign plan');
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  getSelectedPlan(): any {
    return this.plans.find(p => p.id === this.planForm.plan_id);
  }

  // ── Page Access Modal (Super User assigns page+action per company) ──
  openAccessModal(company: any) {
    this.accessCompany = company;
    this.accessLoading = true;
    this.showAccessModal = true;
    this.companyPermIds = new Set();
    this.cdr.detectChanges();

    // Load all permissions + current company permissions in parallel
    const loadAll = this.companyService.getGroupedPermissions();
    const loadCompany = this.companyService.getCompanyPermissions(company.id);

    loadAll.subscribe({
      next: grouped => {
        this.allPermissions = grouped;
        loadCompany.subscribe({
          next: current => {
            this.companyPermIds = new Set(current.map((p: any) => p.id));
            this.accessLoading = false;
            this.cdr.detectChanges();
          },
          error: () => {
            this.accessLoading = false;
            this.cdr.detectChanges();
          }
        });
      },
      error: () => {
        this.toast.error('Failed to load permissions');
        this.accessLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  closeAccessModal() {
    this.showAccessModal = false;
    this.accessCompany = null;
    this.cdr.detectChanges();
  }

  // Permission helpers for access modal
  getAccessGroups(): string[] {
    return [...new Set(this.allPermissions.map((m: any) => m.group))] as string[];
  }

  getModulesByGroup(group: string): any[] {
    return this.allPermissions.filter((m: any) => m.group === group);
  }

  isPermSelected(permId: number): boolean {
    return this.companyPermIds.has(permId);
  }

  togglePerm(permId: number) {
    const s = new Set(this.companyPermIds);
    s.has(permId) ? s.delete(permId) : s.add(permId);
    this.companyPermIds = s;
    this.cdr.detectChanges();
  }

  // Toggle all actions for a module
  toggleModule(mod: any) {
    const s = new Set(this.companyPermIds);
    const allSelected = mod.permissions.every((p: any) => s.has(p.id));
    mod.permissions.forEach((p: any) => allSelected ? s.delete(p.id) : s.add(p.id));
    this.companyPermIds = s;
    this.cdr.detectChanges();
  }

  isModuleAllSelected(mod: any): boolean {
    return mod.permissions.length > 0 && mod.permissions.every((p: any) => this.companyPermIds.has(p.id));
  }

  isModulePartial(mod: any): boolean {
    const count = mod.permissions.filter((p: any) => this.companyPermIds.has(p.id)).length;
    return count > 0 && count < mod.permissions.length;
  }

  // Toggle entire group
  toggleGroup(group: string) {
    const mods = this.getModulesByGroup(group);
    const s = new Set(this.companyPermIds);
    const allSelected = mods.every(m => m.permissions.every((p: any) => s.has(p.id)));
    mods.forEach(m => m.permissions.forEach((p: any) => allSelected ? s.delete(p.id) : s.add(p.id)));
    this.companyPermIds = s;
    this.cdr.detectChanges();
  }

  isGroupAllSelected(group: string): boolean {
    const mods = this.getModulesByGroup(group);
    return mods.every(m => m.permissions.every((p: any) => this.companyPermIds.has(p.id)));
  }

  isGroupPartial(group: string): boolean {
    const mods = this.getModulesByGroup(group);
    const allPerms = mods.flatMap(m => m.permissions);
    const count = allPerms.filter((p: any) => this.companyPermIds.has(p.id)).length;
    return count > 0 && count < allPerms.length;
  }

  saveCompanyAccess() {
    if (!this.accessCompany) return;
    this.accessLoading = true;
    this.cdr.detectChanges();
    this.companyService.assignCompanyPermissions(this.accessCompany.id, Array.from(this.companyPermIds)).subscribe({
      next: () => {
        this.toast.success('Page access updated for ' + this.accessCompany.company_name);
        this.closeAccessModal();
        this.loadCompanies();
      },
      error: err => {
        this.toast.error(err.error?.message || 'Failed to save page access');
        this.accessLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ── Detail ─────────────────────────────────────
  openDetail(company: any) {
    this.loading = true;
    this.companyService.getCompany(company.id).subscribe({
      next: res => {
        this.detailCompany = res;
        this.showDetailModal = true;
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => { this.toast.error('Failed to load company details'); this.loading = false; this.cdr.detectChanges(); }
    });
  }

  closeDetailModal() {
    this.showDetailModal = false;
    this.detailCompany = null;
    this.cdr.detectChanges();
  }

  // ── Deactivate ─────────────────────────────────
  deactivateCompany(company: any) {
    if (!confirm(`Deactivate "${company.company_name}"? This will disable all users.`)) return;
    this.loading = true;
    this.cdr.detectChanges();
    this.companyService.deleteCompany(company.id).subscribe({
      next: () => { this.toast.success('Company deactivated'); this.loadCompanies(); },
      error: () => { this.toast.error('Failed to deactivate company'); this.loading = false; this.cdr.detectChanges(); }
    });
  }

  // ── Activate ───────────────────────────────────
  activateCompany(company: any) {
    if (!confirm(`Activate "${company.company_name}"? This will re-enable the company and its users.`)) return;
    this.loading = true;
    this.cdr.detectChanges();
    this.companyService.updateCompany(company.id, { is_active: true }).subscribe({
      next: () => { this.toast.success('Company activated'); this.loadCompanies(); },
      error: () => { this.toast.error('Failed to activate company'); this.loading = false; this.cdr.detectChanges(); }
    });
  }

  // ── Permanent Delete ──────────────────────────
  permanentDeleteCompany(company: any) {
    if (!confirm(`PERMANENTLY DELETE "${company.company_name}"?\n\nThis will delete:\n- All users in this company\n- All roles & permissions\n- All machines, shifts, operators\n- All data\n\nThis CANNOT be undone!`)) return;
    this.loading = true;
    this.cdr.detectChanges();
    this.companyService.permanentDeleteCompany(company.id).subscribe({
      next: () => { this.toast.success('Company permanently deleted'); this.loadCompanies(); },
      error: (err: any) => { this.toast.error(err.error?.message || 'Failed to delete company'); this.loading = false; this.cdr.detectChanges(); }
    });
  }

  // ── Plants Modal ───────────────────────────────
  openPlantsModal(company: any) {
    this.plantsCompany  = company;
    this.showPlantsModal = true;
    this.showPlantForm  = false;
    this.plantsError    = '';
    this.loadCompanyPlants();
    this.cdr.detectChanges();
  }

  closePlantsModal() {
    this.showPlantsModal = false;
    this.plantsCompany   = null;
    this.plants          = [];
    this.cdr.detectChanges();
  }

  loadCompanyPlants() {
    if (!this.plantsCompany) return;
    this.plantsLoading = true;
    this.cdr.detectChanges();
    this.companyService.getCompanyPlants(this.plantsCompany.id).subscribe({
      next: res => {
        this.plants       = res.data || [];
        this.plantsLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.plantsError  = 'Failed to load plants';
        this.plantsLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  openPlantCreate() {
    this.plantFormData  = null;
    this.plantForm      = { plant_code: '', plant_name: '', location: '' };
    this.plantFormError = '';
    this.showPlantForm  = true;
    this.cdr.detectChanges();
  }

  openPlantEdit(plant: any) {
    this.plantFormData  = plant;
    this.plantForm      = { plant_code: plant.plant_code, plant_name: plant.plant_name, location: plant.location || '' };
    this.plantFormError = '';
    this.showPlantForm  = true;
    this.cdr.detectChanges();
  }

  cancelPlantForm() {
    this.showPlantForm  = false;
    this.plantFormError = '';
    this.cdr.detectChanges();
  }

  savePlant() {
    if (!this.plantForm.plant_code?.trim() || !this.plantForm.plant_name?.trim()) {
      this.plantFormError = 'Plant code and name are required';
      return;
    }
    this.plantFormSaving = true;
    this.plantFormError  = '';
    this.cdr.detectChanges();

    const req = this.plantFormData
      ? this.companyService.updateCompanyPlant(this.plantsCompany.id, this.plantFormData.id, this.plantForm)
      : this.companyService.createCompanyPlant(this.plantsCompany.id, this.plantForm);

    req.subscribe({
      next: () => {
        this.plantFormSaving = false;
        this.showPlantForm   = false;
        this.loadCompanyPlants();
        this.toast.success(this.plantFormData ? 'Plant updated' : 'Plant created');
      },
      error: err => {
        this.plantFormSaving = false;
        this.plantFormError  = err?.error?.message || 'Failed to save plant';
        this.cdr.detectChanges();
      }
    });
  }

  togglePlantStatus(plant: any) {
    this.companyService.toggleCompanyPlantStatus(this.plantsCompany.id, plant.id, !plant.is_active).subscribe({
      next: () => { plant.is_active = !plant.is_active; this.cdr.detectChanges(); },
      error: () => this.toast.error('Failed to update status')
    });
  }

  // ── Helpers ────────────────────────────────────
  getTierBadgeClass(tier: number): string {
    if (tier === 3) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
    if (tier === 2) return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
    return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300';
  }
}
