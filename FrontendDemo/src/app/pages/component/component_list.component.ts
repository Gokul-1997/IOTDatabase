import { ChangeDetectorRef, Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

import { ComponentApi } from './component.api';
import { SocketService } from '../../core/services/socket.service';

import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-component-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    MatTableModule, MatPaginatorModule, MatSortModule,
    MatButtonModule, MatIconModule, MatInputModule,
    MatTooltipModule, MatProgressSpinnerModule
  ],
  templateUrl: './component_list.component.html',
  styleUrl: './component_list.component.scss'
})
export class ComponentList implements OnInit, OnDestroy {

  form!: FormGroup;

  displayedColumns = ['index', 'machine_serial_no', 'part_name', 'part_number', 'operation_number', 'cycle_time', 'target', 'multiplication_factor', 'actions'];

  components: any[] = [];
  machines: any[] = [];

  page    = 1;
  limit   = 10;
  total   = 0;
  search  = '';
  loading = false;

  showModal  = false;
  editing    = false;
  editingId: number | null = null;

  deleteTarget: any  = null;
  deleting           = false;

  private searchSubject = new Subject<string>();
  private destroy$      = new Subject<void>();

  constructor(
    private fb:            FormBuilder,
    private api:           ComponentApi,
    private socketService: SocketService,
    private cdr:           ChangeDetectorRef,
    public auth:           AuthService
  ) {}

  ngOnInit() {
    this.initForm();
    this.loadMachines();

    this.searchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.page = 1;
      this.load();
    });

    this.load();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadMachines() {
    this.api.getMachines().subscribe(res => {
      this.machines = res.data;
    });
  }

  initForm() {
    this.form = this.fb.group({
      machine_id:            ['', Validators.required],
      part_name:             ['', Validators.required],
      part_number:           [''],
      operation_number:      [''],
      cycle_time:            ['', [Validators.required, Validators.pattern(/^([0-1]\d|2[0-3]):([0-5]\d):([0-5]\d)$/)]],
      target:                ['', Validators.required],
      multiplication_factor: [1]
    });
  }

  load() {
    this.loading = true;
    this.api.list(this.page, this.limit, this.search).subscribe({
      next: res => {
        this.components = res.data;
        this.total      = res.meta.total;
        this.loading    = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  onSearchInput() {
    this.searchSubject.next(this.search);
  }

  onPage(e: any) {
    this.page  = e.pageIndex + 1;
    this.limit = e.pageSize;
    this.load();
  }

  rowIndex(i: number) {
    return (this.page - 1) * this.limit + i + 1;
  }

  formatCycleTimeTable(t: any): string {
    if (!t) return '00:00:00';
    const h = String(t.hours   ?? 0).padStart(2, '0');
    const m = String(t.minutes ?? 0).padStart(2, '0');
    const s = String(t.seconds ?? 0).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  formatCycleTime(event: any) {
    let value = event.target.value.replace(/\D/g, '');
    if (value.length > 6) value = value.substring(0, 6);
    if (value.length >= 5)      value = value.replace(/^(\d{2})(\d{2})(\d{1,2})$/, '$1:$2:$3');
    else if (value.length >= 3) value = value.replace(/^(\d{2})(\d{1,2})$/, '$1:$2');
    this.form.patchValue({ cycle_time: value }, { emitEvent: false });
  }

  openModal() {
    this.showModal = true;
    this.editing   = false;
    this.form.reset({ multiplication_factor: 1 });
  }

  closeModal() {
    this.showModal  = false;
    this.editing    = false;
    this.editingId  = null;
  }

  submit() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const time = this.form.value.cycle_time;
    if (!/^([0-1]\d|2[0-3]):([0-5]\d):([0-5]\d)$/.test(time)) return;

    if (this.editing && this.editingId) {
      this.api.update(this.editingId, this.form.value).subscribe(() => {
        this.load();
        this.closeModal();
      });
    } else {
      this.api.create(this.form.value).subscribe(() => {
        this.load();
        this.closeModal();
      });
    }
  }

  edit(data: any) {
    this.editing   = true;
    this.editingId = data.id;
    this.showModal = true;
    this.form.patchValue({
      ...data,
      cycle_time: this.formatCycleTimeTable(data.cycle_time)
    });
  }

  confirmDelete(row: any) { this.deleteTarget = row; }
  cancelDelete()          { this.deleteTarget = null; this.deleting = false; }

  doDelete() {
    if (!this.deleteTarget) return;
    this.deleting = true;
    this.api.delete(this.deleteTarget.id).subscribe({
      next: () => {
        this.deleting     = false;
        this.deleteTarget = null;
        this.load();
      },
      error: () => { this.deleting = false; }
    });
  }
}
