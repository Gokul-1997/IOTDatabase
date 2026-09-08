import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  AfterViewInit,
  ChangeDetectorRef,
  ElementRef,
  HostListener
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
  templateUrl: './machine-form.component.html',
  styleUrls: ['./machine-form.component.scss']
})
export class MachineFormComponent implements OnInit, AfterViewInit {

  @Input() data: any;
  @Output() saved = new EventEmitter<void>();
  @Output() close = new EventEmitter<void>();

  uploading = false;
  testingConnection = false;
  previewUrl: string | null = null;
  lines: any[] = [];
  form!: FormGroup;

  /** Result of the last FTP test, shown inline beside the button. */
  connectionResult: { ok: boolean; message: string } | null = null;

  /** Rendered as one row so the five axes read as a single group. */
  readonly axes = [
    { key: 'x_axis',      label: 'X axis',   placeholder: '1050' },
    { key: 'y_axis',      label: 'Y axis',   placeholder: '530'  },
    { key: 'z_axis',      label: 'Z axis',   placeholder: '510'  },
    { key: 'fourth_axis', label: '4th axis', placeholder: '360'  },
    { key: 'fifth_axis',  label: '5th axis', placeholder: '120'  }
  ];

  constructor(
    private fb: FormBuilder,
    private service: MachinesService,
    private toast: ToastService,
    private programService: ProgramService,
    private cdr: ChangeDetectorRef,
    private host: ElementRef<HTMLElement>
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

  ngAfterViewInit() {
    // Send focus into the dialog so a keyboard user is not left on the page
    // behind it. The line select is the first thing to fill in.
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('#mfLine')?.focus());
  }

  ////////////////////////////////////////////
  // DIALOG BEHAVIOUR
  ////////////////////////////////////////////

  /** Escape closes, as every dialog is expected to. */
  @HostListener('document:keydown.escape')
  onEscape() { this.close.emit(); }

  /** Click the backdrop to dismiss; clicks inside the card are stopped in the template. */
  onOverlayClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('mf-overlay')) this.close.emit();
  }

  /**
   * Keep Tab inside the dialog. Without this, tabbing past the last button
   * walks into the page behind, which is still rendered and clickable.
   */
  @HostListener('document:keydown.tab', ['$event'])
  @HostListener('document:keydown.shift.tab', ['$event'])
  onTab(rawEvent: Event) {
    const event = rawEvent as KeyboardEvent;
    const focusable = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => el.offsetParent !== null);

    if (!focusable.length) return;

    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Show an error only once the user has left the field, not while typing. */
  invalid(name: string): boolean {
    const c = this.form?.get(name);
    return !!c && c.invalid && (c.touched || c.dirty);
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
        this.cdr.detectChanges();
      },
      error: () => {
        this.toast.error('Image upload failed. Please try again.');
        this.uploading = false;
        this.cdr.detectChanges();
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
    this.connectionResult = null;
    this.programService.testConnection({
      machine_id: this.data?.id,
      ip_address: v.ip_address,
      ftp_port: v.ftp_port,
      ftp_user: v.ftp_user,
      ftp_pass: v.ftp_pass   // blank = use saved password (write-only)
    }).subscribe({
      next: () => {
        this.testingConnection = false;
        // Kept on screen rather than only toasted — a toast is gone before
        // you can compare it against the IP you just typed.
        this.connectionResult = { ok: true, message: 'Controller reachable' };
        this.cdr.detectChanges();
      },
      error: err => {
        this.testingConnection = false;
        this.connectionResult = {
          ok: false,
          message: err.error?.message || 'Could not reach the controller'
        };
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
      this.cdr.detectChanges();

      // Move focus to the first problem rather than leaving the user to hunt
      // for red borders in a form four sections long.
      const firstInvalid = Object.keys(this.form.controls).find(k => this.form.get(k)?.invalid);
      const map: Record<string, string> = { line_id: '#mfLine', machine_serial_no: '#mfSerial' };
      const el = firstInvalid && map[firstInvalid]
        ? this.host.nativeElement.querySelector<HTMLElement>(map[firstInvalid])
        : null;
      el?.focus();
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
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