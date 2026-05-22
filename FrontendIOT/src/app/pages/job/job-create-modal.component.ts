import { Component, EventEmitter, Output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { JobService } from './job.service';

@Component({
  standalone: true,
  selector: 'app-job-create-modal',
  imports: [CommonModule, FormsModule],
  templateUrl: './job-create-modal.component.html'
})
export class JobCreateModalComponent implements OnInit {

  @Output() close = new EventEmitter();

  form: any = {
    machine_id:   '',
    component_id: '',
    job_start:    ''
  };

  machines:   any[] = [];
  components: any[] = [];
  saving    = false;
  error     = '';

  constructor(private service: JobService) {}

  ngOnInit() {
    this.loadData();
    // Default job_start to now (local datetime-local format)
    const now = new Date();
    now.setSeconds(0, 0);
    this.form.job_start = now.toISOString().slice(0, 16);
  }

  loadData() {
    this.service.getAvailableMachines().subscribe((res: any) => {
      this.machines = res.data || [];
    });
  }

  onMachineChange() {
    this.form.component_id = '';
    this.components = [];
    if (this.form.machine_id) {
      this.service.getComponents(this.form.machine_id).subscribe((res: any) => {
        this.components = res.data || [];
      });
    }
  }

  save() {
    this.error = '';
    if (!this.form.machine_id)   { this.error = 'Please select a machine.';   return; }
    if (!this.form.component_id) { this.error = 'Please select a component.'; return; }
    if (!this.form.job_start)    { this.error = 'Please enter job start time.'; return; }

    this.saving = true;
    this.service.startJob(this.form).subscribe({
      next: () => {
        this.saving = false;
        this.close.emit();
      },
      error: (err: any) => {
        this.saving = false;
        this.error  = err?.error?.message || 'Failed to start job. Try again.';
      }
    });
  }

  cancel() { this.close.emit(); }
}
