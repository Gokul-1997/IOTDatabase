import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  AbstractControl,
  ValidationErrors
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { finalize } from 'rxjs';
import { ShiftsService } from './shifts.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  standalone: true,
  selector: 'app-shift-form',
  templateUrl: './shift-form.component.html',
  imports: [CommonModule, ReactiveFormsModule]
})
export class ShiftFormComponent implements OnInit {

  @Input() data: any;
  @Output() saved = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  saving = false;
  form!: FormGroup;

  constructor(
    private fb: FormBuilder,
    private service: ShiftsService,
    private toast: ToastService
  ) {}

  ngOnInit() {
    this.form = this.fb.group({
      shift_code:    ['', Validators.required],
      shift_name:    [''],
      start_time:    ['', Validators.required],
      end_time:      ['', Validators.required],
      break_minutes: [0, [Validators.required, Validators.min(0)]],
      is_active:     [true]
    }, { validators: this.shiftValidator });

    if (this.data) {
      this.form.patchValue({
        shift_code:    this.data.shift_code,
        shift_name:    this.data.shift_name,
        start_time:    this.data.start_time?.slice(0, 5),
        end_time:      this.data.end_time?.slice(0, 5),
        break_minutes: this.data.break_minutes,
        is_active:     this.data.is_active !== false
      });
    }
  }

  shiftValidator = (group: AbstractControl): ValidationErrors | null => {
    const start    = group.get('start_time')?.value;
    const end      = group.get('end_time')?.value;
    const breakMin = Number(group.get('break_minutes')?.value || 0);

    if (!start || !end) return null;

    const startMin = this.timeToMinutes(start);
    const endMin   = this.timeToMinutes(end);

    let duration: number;
    if (startMin === endMin) {
      duration = 1440;
    } else if (endMin > startMin) {
      duration = endMin - startMin;
    } else {
      duration = (1440 - startMin) + endMin;
    }

    if (duration <= 0 || duration > 1440) return { invalidDuration: true };
    if (breakMin >= duration)             return { invalidBreak: true };
    return null;
  };

  private timeToMinutes(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.saving = true;
    const payload = { ...this.form.value, break_minutes: Number(this.form.value.break_minutes) };

    if (this.data) {
      const changed: any = {};
      Object.keys(payload).forEach(key => {
        // DB returns times as "HH:MM:SS" — normalize to "HH:MM" before comparing
        const dataVal = (key === 'start_time' || key === 'end_time')
          ? (this.data[key] ?? '').toString().slice(0, 5)
          : this.data[key];
        if (payload[key] !== dataVal) changed[key] = payload[key];
      });

      if (Object.keys(changed).length === 0) {
        this.saving = false;
        this.close.emit();
        return;
      }

      this.service.update(this.data.id, changed)
        .pipe(finalize(() => { this.saving = false; }))
        .subscribe({
          next: () => this.saved.emit(),
          error: (err: any) => {
            this.saving = false;
            this.toast.error(err?.error?.message || 'Update failed. Try again.');
          }
        });
    } else {
      this.service.create(payload)
        .pipe(finalize(() => { this.saving = false; }))
        .subscribe({
          next: () => this.saved.emit(),
          error: (err: any) => {
            this.saving = false;
            this.toast.error(err?.error?.message || 'Create failed. Try again.');
          }
        });
    }
  }

  openTimePicker(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.showPicker) input.showPicker();
  }
}
