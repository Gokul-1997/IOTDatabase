import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  ChangeDetectorRef
} from '@angular/core';

import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  Validators,
  FormGroup
} from '@angular/forms';

import { MachinesService } from './machines.service';
import { ToastService } from '../../core/services/toast.service';
import { ProgramService } from '../../core/services/program.service';

@Component({
  standalone: true,
  selector: 'app-machine-form',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './machine-form.component.html'
})
export class MachineFormComponent implements OnInit {

  @Input() data: any;
  @Output() saved = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  uploading = false;
  testingConnection = false;
  previewUrl: string | null = null;
  lines: any[] = [];
  form!: FormGroup;

  constructor(
    private fb: FormBuilder,
    private service: MachinesService,
    private toast: ToastService,
    private programService: ProgramService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {

    this.form = this.fb.group({
      machine_serial_no: ['', Validators.required],
      model: [''],
      image_url: [''],
      controller: [''],
      mmc_no: [''],
      spindle_rpm: [''],
      x_axis: [''],
      y_axis: [''],
      z_axis: [''],
      fourth_axis: [''],
      fifth_axis: [''],
      twin_spindle: [false],
      twin_table: [false],
      atc_tool_capacity: [''],
      line_id: [null, Validators.required],
      is_active: [true],
      ip_address: [''],
      ftp_port: [21],
      ftp_user: [''],
      ftp_pass: [''],
      ftp_dir: ['']
    });
    this.loadLines();
  }

  ////////////////////////////////////////////
  // LOAD LINES + PATCH DATA
  ////////////////////////////////////////////

  loadLines() {
    this.service.getLines().subscribe(res => {
      this.lines = res.data;

      if (this.data) {
        this.form.patchValue({
          ...this.data,
          line_id: Number(this.data.line_id)
        });

        this.previewUrl = this.data.image_url;
      }

      this.cdr.detectChanges();
    });
  }

  ////////////////////////////////////////////
  // IMAGE UPLOAD
  ////////////////////////////////////////////

  onFileSelect(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    this.previewUrl = URL.createObjectURL(file);
    this.uploading = true;

    this.service.uploadToS3(file).subscribe({
      next: (res: any) => {
        this.form.patchValue({ image_url: res.fileUrl });

        // ✅ ensure change detection for update
        this.form.get('image_url')?.markAsDirty();

        this.uploading = false;
      },
      error: () => {
        this.toast.error('Image upload failed. Please try again.');
        this.uploading = false;
      }
    });
  }

  ////////////////////////////////////////////
  // TEST FTP CONNECTION
  ////////////////////////////////////////////

  testConnection() {
    const v = this.form.value;
    if (!v.ip_address) {
      this.toast.error('Enter the machine IP address first');
      return;
    }

    this.testingConnection = true;
    this.programService.testConnection({
      machine_id: this.data?.id,
      ip_address: v.ip_address,
      ftp_port: v.ftp_port,
      ftp_user: v.ftp_user,
      ftp_pass: v.ftp_pass   // blank = use saved password (write-only)
    }).subscribe({
      next: () => {
        this.testingConnection = false;
        this.toast.success('FTP connection successful');
        this.cdr.detectChanges();
      },
      error: err => {
        this.testingConnection = false;
        this.toast.error(err.error?.message || 'FTP connection failed');
        this.cdr.detectChanges();
      }
    });
  }

  ////////////////////////////////////////////
  // SAVE (PRODUCTION SAFE)
  ////////////////////////////////////////////

  save() {

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    if (this.data) {

      // 🔥 Compare values instead of dirty
      const changed: any = {};

      Object.keys(this.form.controls).forEach(key => {
        // ftp_pass is write-only: the API never returns it, so an empty
        // field means "unchanged", not "clear the password"
        if (key === 'ftp_pass') {
          if (this.form.get(key)?.value) changed[key] = this.form.get(key)?.value;
          return;
        }
        if (this.form.get(key)?.value !== this.data[key]) {
          changed[key] = this.form.get(key)?.value;
        }
      });

      // Nothing changed → close modal
      if (Object.keys(changed).length === 0) {
        this.close.emit();
        return;
      }

      this.service.update(this.data.id, changed)
        .subscribe(() => this.saved.emit());

    } else {

      // Create → full form
      this.service.create(this.form.value)
        .subscribe(() => this.saved.emit());
    }
  }

  ////////////////////////////////////////////
  // OPTIONAL: DISABLE SAVE IF NO CHANGES
  ////////////////////////////////////////////

  get isUnchanged(): boolean {
    if (!this.data) return false;

    return Object.keys(this.form.controls)
      .every(key => key === 'ftp_pass'
        ? !this.form.get(key)?.value   // blank password = unchanged
        : this.form.get(key)?.value === this.data[key]);
  }
}