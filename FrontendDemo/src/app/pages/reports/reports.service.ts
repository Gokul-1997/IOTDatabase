import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type ReportType = 'production' | 'oee-hourly' | 'shift-oee';

export interface ReportFilters {
  date_from:   string;
  date_to:     string;
  machine_id:  string;
  shift_id:    string;
  operator_id: string;
}

@Injectable({ providedIn: 'root' })
export class ReportsService {

  private api = environment.apiUrl + '/reports';

  constructor(private http: HttpClient) {}

  getMachines(): Observable<any>  { return this.http.get(`${this.api}/machines`);  }
  getShifts(): Observable<any>    { return this.http.get(`${this.api}/shifts`);    }
  getOperators(machine_id?: string): Observable<any> {
    const params: Record<string, string> = {};
    if (machine_id) params['machine_id'] = machine_id;
    return this.http.get(`${this.api}/operators`, { params });
  }

  getProductionData(f: ReportFilters): Observable<any> {
    return this.http.get(`${this.api}/production-data`, { params: this.toParams(f) });
  }

  getOeeHourlyData(f: ReportFilters): Observable<any> {
    return this.http.get(`${this.api}/oee-hourly-data`, { params: this.toParams(f) });
  }

  getShiftOeeData(f: ReportFilters): Observable<any> {
    return this.http.get(`${this.api}/shift-oee-data`, { params: this.toParams(f) });
  }

  /** Client-side CSV export using the already-fetched rows + active column selection */
  exportCsv(filename: string, cols: { key: string; label: string }[], rows: any[]): void {
    const header = cols.map(c => `"${c.label}"`).join(',');
    const body   = rows.map(r =>
      cols.map(c => {
        const v = r[c.key] ?? '';
        return `"${String(v).replace(/"/g, '""')}"`;
      }).join(',')
    ).join('\n');

    const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Full Excel download (all columns, uses backend) */
  downloadExcel(type: ReportType, date: string): void {
    const pathMap: Record<ReportType, string> = {
      'production': `${this.api}/production?date=${date}`,
      'oee-hourly': `${this.api}/hourly-oee?date=${date}`,
      'shift-oee':  `${this.api}/shift-oee?date=${date}`,
    };
    this.http.get(pathMap[type], { responseType: 'blob' }).subscribe(blob => {
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href  = url;
      link.download = `${type}_${date}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  private toParams(f: ReportFilters): Record<string, string> {
    const p: Record<string, string> = {
      date_from: f.date_from,
      date_to:   f.date_to,
    };
    if (f.machine_id)  p['machine_id']  = f.machine_id;
    if (f.shift_id)    p['shift_id']    = f.shift_id;
    if (f.operator_id) p['operator_id'] = f.operator_id;
    return p;
  }
}
