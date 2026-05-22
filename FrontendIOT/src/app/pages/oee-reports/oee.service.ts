import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class OeeReportsService {

  private baseUrl = `${environment.apiUrl}/oee`;

  constructor(private http: HttpClient) {}

  /**
   * GET /oee/meta
   * Get metadata: machines, shifts, lines
   */
  getMeta(): Observable<any> {
    return this.http.get(`${this.baseUrl}/meta`);
  }

  /**
   * GET /oee/reports
   * Get OEE reports with filters and pagination
   */
  getReports(filters: any): Observable<any> {
    let params = new HttpParams();

    // Add all filter parameters
    Object.keys(filters).forEach(key => {
      if (filters[key] !== null && filters[key] !== undefined && filters[key] !== '') {
        params = params.set(key, filters[key]);
      }
    });

    return this.http.get(`${this.baseUrl}/reports`, { params });
  }

  /**
   * GET /oee/export
   * Export OEE data to CSV
   */
  exportCSV(filters: any): void {
    let params = new HttpParams();

    Object.keys(filters).forEach(key => {
      if (filters[key] !== null && filters[key] !== undefined && filters[key] !== '') {
        params = params.set(key, filters[key]);
      }
    });

    this.http.get(`${this.baseUrl}/export`, { params, responseType: 'blob' }).subscribe(blob => {
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href  = url;
      const from = filters['from_date'] || filters['date'] || 'export';
      link.download = `oee_${from}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

}