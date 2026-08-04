import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, Validators, ReactiveFormsModule, FormGroup } from '@angular/forms';
import { OperatorService } from '../operators/operator.service';
import { ShiftsService } from '../shifts/shifts.service';
import { AssignmentService } from './assignment.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  standalone: true,
  selector: 'app-operator-shift',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './operator-shift.component.html',
  styleUrls: ['./operator-shift.component.scss']
})
export class OperatorShiftComponent implements OnInit {

  operators: any[] = [];
  shifts: any[] = [];
  saving = false;

  form!: FormGroup;

  constructor(
    private fb: FormBuilder,
    private operatorService: OperatorService,
    private shiftService: ShiftsService,
    private assignmentService: AssignmentService,
    public auth: AuthService
  ) { }

  ngOnInit() {
    this.form = this.fb.group({
      operator_id: ['', Validators.required],
      shift_id: ['', Validators.required],
      effective_from: ['', Validators.required]
    });
    this.operatorService.getAll().subscribe(d => this.operators = d);
    this.shiftService.getShifts().subscribe(d => this.shifts = d);
  }

  submit() {
    if (this.form.invalid) return;

    this.saving = true;

    this.assignmentService.assignOperatorShift(this.form.value).subscribe({
      next: () => {
        this.saving = false;
        alert('Operator assigned to shift');
        this.form.reset();
      },
      error: () => {
        this.saving = false;
        alert('Assignment failed');
      }
    });
  }
}
