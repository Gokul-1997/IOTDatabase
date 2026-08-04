import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TwofaService } from '../../core/services/twofa.service';

@Component({
  selector: 'app-twofa-setup',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './twofa-setup.component.html'
})
export class TwofaSetupComponent implements OnInit {
  status: any = null;
  step: 'status' | 'setup' | 'verify' | 'backup' = 'status';
  qrDataUrl = '';
  secret = '';
  token = '';
  backupCodes: string[] = [];
  error = '';
  loading = false;

  constructor(private svc: TwofaService) {}

  ngOnInit() { this.loadStatus(); }

  loadStatus() {
    this.svc.getStatus().subscribe({ next: r => { this.status = r.data; } });
  }

  startSetup() {
    this.loading = true;
    this.svc.setup().subscribe({
      next: r => { this.qrDataUrl = r.data.qrDataUrl; this.secret = r.data.secret; this.step = 'setup'; this.loading = false; },
      error: e => { this.error = e.error?.message || 'Setup failed'; this.loading = false; }
    });
  }

  enable() {
    if (!this.token) { this.error = 'Enter the 6-digit code'; return; }
    this.loading = true;
    this.svc.enable(this.token).subscribe({
      next: r => { this.backupCodes = r.data.backup_codes; this.step = 'backup'; this.loading = false; this.loadStatus(); },
      error: e => { this.error = e.error?.message || 'Invalid code'; this.loading = false; }
    });
  }

  disable() {
    if (!confirm('Are you sure you want to disable 2FA?')) return;
    this.svc.disable().subscribe({ next: () => { this.step = 'status'; this.loadStatus(); } });
  }
}
