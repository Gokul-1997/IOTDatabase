import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

import { LinesService } from './lines.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  standalone: true,
  selector: 'app-line-form',
  templateUrl: './line-form.component.html',
  imports: [CommonModule, ReactiveFormsModule, MatIconModule]
})
export class LineFormComponent implements OnInit {

  @Input() data: any;
  @Output() saved = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  form!: FormGroup;
  saving = false;

  constructor(
    private fb: FormBuilder,
    private service: LinesService,
    private toast: ToastService
  ) {}

  ngOnInit() {
    this.form = this.fb.group({
      name: ['', Validators.required],
      is_active: [true]
    });

    if (this.data) {
      this.form.patchValue({
        name: this.data.name || '',
        is_active: this.data.is_active !== false
      });
    }
  }

  submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.saving = true;
    const payload = this.form.value;

    if (this.data) {
      const changed: any = {};
      Object.keys(payload).forEach(key => {
        if (payload[key] !== this.data[key]) changed[key] = payload[key];
      });

      if (Object.keys(changed).length === 0) {
        this.saving = false;
        this.close.emit();
        return;
      }

      this.service.updateLine(this.data.id, changed).subscribe({
        next: () => { this.saving = false; this.saved.emit(); },
        error: (err: any) => {
          this.saving = false;
          this.toast.error(err?.error?.message || 'Update failed. Try again.');
        }
      });
    } else {
      this.service.createLine(payload).subscribe({
        next: () => { this.saving = false; this.saved.emit(); },
        error: (err: any) => {
          this.saving = false;
          this.toast.error(err?.error?.message || 'Create failed. Try again.');
        }
      });
    }
  }
}
