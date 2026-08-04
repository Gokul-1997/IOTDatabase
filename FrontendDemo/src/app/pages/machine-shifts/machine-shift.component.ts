import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule
} from '@angular/forms';

import { MachinesService } from '../machines/machines.service';
import { ShiftsService } from '../shifts/shifts.service';
import { MachineShiftService } from './machine-shift.service';

@Component({
  standalone: true,
  selector: 'app-machine-shift',
  imports: [CommonModule, ReactiveFormsModule,FormsModule], // ✅ NO FormsModule
  templateUrl: './machine-shift.component.html',
  styleUrls: ['./machine-shift.component.scss']
})
export class MachineShiftComponent implements OnInit {

  machines: any[] = [];
  shifts: any[] = [];
  selectedShifts: number[] = [];

  form!: FormGroup;

  constructor(
    private fb: FormBuilder,
    private machineService: MachinesService,
    private shiftService: ShiftsService,
    private machineShiftService: MachineShiftService
  ) {}

  ngOnInit() {
    this.form = this.fb.group({
      machine_id: ['']
    });

    this.machineService.getAllForDropdown().subscribe((res: any) => {
      this.machines = res.data || [];
    });
    this.shiftService.getShifts().subscribe(d => this.shifts = d);
  }

  loadConfig() {
    const machineId = this.form.value.machine_id;
    if (!machineId) return;

    this.machineShiftService.getByMachine(machineId).subscribe(res => {
      this.selectedShifts = res.map((x: any) => x.shift_id);
    });
  }

  toggleShift(shiftId: number, checked: boolean) {
    if (checked) {
      if (!this.selectedShifts.includes(shiftId)) {
        this.selectedShifts.push(shiftId);
      }
    } else {
      this.selectedShifts = this.selectedShifts.filter(x => x !== shiftId);
    }
  }

  save() {
    const payload = {
      machine_id: this.form.value.machine_id,
      shift_ids: this.selectedShifts
    };

    this.machineShiftService.save(payload).subscribe(() => {
      alert('Machine shift configuration saved');
    });
  }
}
