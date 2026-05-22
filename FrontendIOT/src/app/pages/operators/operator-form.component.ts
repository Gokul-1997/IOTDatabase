import { Component, Input, Output, EventEmitter, OnInit, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { forkJoin } from 'rxjs';

import { OperatorService } from './operator.service';
import { ToastService } from '../../core/services/toast.service';
import { MatIconModule } from '@angular/material/icon';

@Component({
  standalone: true,
  selector: 'app-operator-form',
  templateUrl: './operator-form.component.html',
  imports: [CommonModule, ReactiveFormsModule, MatIconModule]
})
export class OperatorFormComponent implements OnInit {

  @Input() data: any;
  @Output() saved = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  form!: FormGroup;
  shifts: any[] = [];
  machines: any[] = [];
  saving = false;

  constructor(
    private fb: FormBuilder,
    private service: OperatorService,
    private toast: ToastService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.form = this.fb.group({
      operator_code: ['', Validators.required],
      operator_name: ['', Validators.required],
      skill_level:   [''],
      shift_id:      [null, Validators.required],
      machine_ids:   [[]],
      is_active:     [true]
    });

    this.loadMasters();
  }

  loadMasters() {
    forkJoin({
      shifts:   this.service.getShifts(),
      machines: this.service.getMachines()
    }).subscribe((res: any) => {
      this.shifts   = res.shifts.data   || [];
      this.machines = res.machines.data || [];

      if (this.data) {
        this.form.patchValue({
          operator_code: this.data.operator_code,
          operator_name: this.data.operator_name,
          skill_level:   this.data.skill_level,
          shift_id:      Number(this.data.shift_id),
          machine_ids:   (this.data.machine_ids || []).map(Number),
          is_active:     this.data.is_active
        });
      }

      this.cdr.detectChanges();
    });
  }

  isMachineSelected(id: number): boolean {
    return (this.form.get('machine_ids')?.value || []).includes(+id);
  }

  toggleMachine(id: number) {
    const current: number[] = [...(this.form.get('machine_ids')?.value || [])];
    const idx = current.indexOf(+id);
    if (idx === -1) current.push(+id);
    else current.splice(idx, 1);
    this.form.get('machine_ids')?.setValue(current);
  }

  submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.saving = true;

    if (this.data) {
      const changed: any = {};
      Object.keys(this.form.controls).forEach(key => {
        const newVal = this.form.get(key)?.value;
        const oldVal = this.data[key];
        if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) changed[key] = newVal;
      });

      if (Object.keys(changed).length === 0) {
        this.saving = false;
        this.close.emit();
        return;
      }

      this.service.update(this.data.id, changed).subscribe({
        next: () => { this.saving = false; this.saved.emit(); },
        error: (err: any) => {
          this.saving = false;
          this.toast.error(err?.error?.message || 'Update failed. Try again.');
        }
      });
    } else {
      this.service.create(this.form.value).subscribe({
        next: () => { this.saving = false; this.saved.emit(); },
        error: (err: any) => {
          this.saving = false;
          this.toast.error(err?.error?.message || 'Create failed. Try again.');
        }
      });
    }
  }
}
