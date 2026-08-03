import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ProgramService {
  private api = `${environment.apiUrl}/programs`;

  constructor(private http: HttpClient) {}

  getPrograms(params: any = {}) {
    return this.http.get<any>(this.api, { params });
  }

  upload(file: File, name: string, description: string) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    formData.append('description', description);
    return this.http.post<any>(this.api, formData);
  }

  delete(id: number) {
    return this.http.delete<any>(`${this.api}/${id}`);
  }

  download(id: number) {
    return this.http.get(`${this.api}/${id}/download`, { responseType: 'blob' });
  }

  transfer(programId: number, machineId: number) {
    return this.http.post<any>(`${this.api}/${programId}/transfer/${machineId}`, {});
  }

  getTransfers(params: any = {}) {
    return this.http.get<any>(`${this.api}/transfers`, { params });
  }

  /** Test FTP connection. Pass form values; blank password falls back to the
   *  stored one when machine_id is provided (password is write-only). */
  testConnection(config: { machine_id?: number; ip_address?: string; ftp_port?: number;
                           ftp_user?: string; ftp_pass?: string }) {
    return this.http.post<any>(`${this.api}/test-connection`, config);
  }
}
