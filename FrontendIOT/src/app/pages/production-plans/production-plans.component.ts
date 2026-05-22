import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProductionPlanService } from '../../core/services/production-plan.service';

@Component({
  selector: 'app-production-plans',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './production-plans.component.html'
})
export class ProductionPlansComponent implements OnInit {
  activeTab: 'plans' | 'variance' = 'plans';
  plans: any[] = [];
  variance: any[] = [];
  pagination: any = {};
  loading = false;
  showForm = false;
  form: any = { machine_id: '', plan_date: '', shift_id: '', planned_qty: '', notes: '' };
  filter: any = { from_date: '', to_date: '', page: 1, limit: 20 };

  constructor(private svc: ProductionPlanService) {}

  ngOnInit() { this.load(); }

  load() {
    this.loading = true;
    const params: any = { ...this.filter };
    Object.keys(params).forEach(k => !params[k] && delete params[k]);
    this.svc.getPlans(params).subscribe({
      next: r => { this.plans = r.data || []; this.pagination = r.pagination || {}; this.loading = false; },
      error: () => this.loading = false
    });
  }

  loadVariance() {
    const params: any = {};
    if (this.filter.from_date) params['from_date'] = this.filter.from_date;
    if (this.filter.to_date)   params['to_date']   = this.filter.to_date;
    this.svc.getVariance(params).subscribe({ next: r => this.variance = r.data || [] });
  }

  setTab(tab: typeof this.activeTab) {
    this.activeTab = tab;
    if (tab === 'variance') this.loadVariance();
  }

  save() {
    this.svc.createPlan(this.form).subscribe({
      next: () => { this.showForm = false; this.form = { machine_id: '', plan_date: '', shift_id: '', planned_qty: '', notes: '' }; this.load(); }
    });
  }

  delete(id: number) {
    if (!confirm('Delete this plan?')) return;
    this.svc.deletePlan(id).subscribe({ next: () => this.load() });
  }

  achievementClass(pct: number) {
    if (pct >= 95) return 'text-green-600 font-semibold';
    if (pct >= 70) return 'text-yellow-600 font-semibold';
    return 'text-red-600 font-semibold';
  }
}
