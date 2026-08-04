import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { OperatorService } from '../operators/operator.service';
import { MachinesService } from '../machines/machines.service';
import { AssignmentService } from './assignment.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  standalone: true,
  selector: 'app-assignment',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './assignment.component.html',
  styleUrls: ['./assignment.component.scss']
})
export class AssignmentComponent implements OnInit {

  operators: any[] = [];
  machines: any[] = [];
  saving = false;

  form!: FormGroup;

  constructor(
    private fb: FormBuilder,
    private operatorService: OperatorService,
    private machineService: MachinesService,
    private assignmentService: AssignmentService,
    public auth: AuthService
  ) { }

  ngOnInit() {
    this.form = this.fb.group({
      operator_id: ['', Validators.required],
      machine_id: ['', Validators.required],
      assigned_from: ['', Validators.required]
    });
    this.operatorService.getAll().subscribe(d => this.operators = d);
    this.machineService.getAllForDropdown().subscribe((res: any) => {
      this.machines = res.data || [];
    });
  }

  submit() {
    if (this.form.invalid) return;

    this.saving = true;

    this.assignmentService.assignOperatorMachine(this.form.value).subscribe({
      next: () => {
        this.saving = false;
        alert('Operator assigned to machine');
        this.form.reset();
      },
      error: () => {
        this.saving = false;
        alert('Assignment failed');
      }
    });
  }
}
