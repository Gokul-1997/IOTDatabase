import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { PlantsService } from './plants.service';

@Component({
  standalone: true,
  selector: 'app-plant-form',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './plant-form.component.html'
})
export class PlantFormComponent implements OnInit {

  @Input() data: any;
  @Output() close = new EventEmitter();
  @Output() saved = new EventEmitter();

  form!: FormGroup;
  saving   = false;
  errorMsg = '';

  constructor(private service: PlantsService, private fb: FormBuilder) {}

  ngOnInit() {
    this.form = this.fb.group({
      plant_code: ['', Validators.required],
      plant_name: ['', Validators.required],
      location: ['']
    });

    if (this.data) {
      this.form.patchValue(this.data);
      this.form.get('plant_code')?.disable();
    }
  }

  save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.saving   = true;
    this.errorMsg = '';
    const payload = this.form.getRawValue();

    const req = this.data
      ? this.service.updatePlant(this.data.id, payload)
      : this.service.createPlant(payload);

    req.subscribe({
      next:  () => { this.saving = false; this.saved.emit(); },
      error: (err) => {
        this.saving   = false;
        this.errorMsg = err?.error?.message || 'Failed to save plant. Please try again.';
      }
    });
  }
}
