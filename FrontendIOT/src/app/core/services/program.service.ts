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

  /** Send one program. Without overwrite the API replies 409 FILE_EXISTS
   *  when the file is already on the controller. */
  transfer(programId: number, machineId: number, overwrite = false) {
    return this.http.post<any>(`${this.api}/${programId}/transfer/${machineId}`, { overwrite });
  }

  /** Send several programs to several machines in one action.
   *  Sending to a controller needs the machine supervisor's one-time code;
   *  without it the API replies 403 APPROVAL_REQUIRED (or
   *  NO_SUPERVISOR_ASSIGNED when nobody is assigned to the machine). */
  transferBatch(
    programIds: number[],
    machineIds: number[],
    overwrite = false,
    auth?: { authorization_id: number; code: string }
  ) {
    return this.http.post<any>(`${this.api}/transfer-batch`, {
      program_ids: programIds,
      machine_ids: machineIds,
      overwrite,
      authorization_id: auth?.authorization_id,
      authorization_code: auth?.code
    });
  }

  /** Ask the machine's supervisor for a one-time code. The response names
   *  the supervisor and masks their address — it never carries the code. */
  requestAuthorization(machineId: number, programIds: number[], supervisorId?: number) {
    return this.http.post<any>(`${this.api}/authorization/request`, {
      machine_id: machineId,
      program_ids: programIds,
      supervisor_id: supervisorId
    });
  }

  /** Who may authorise transfers to this machine. */
  getMachineSupervisors(machineId: number) {
    return this.http.get<any>(`${this.api}/machine/${machineId}/supervisors`);
  }

  /** Files currently sitting on the controller. */
  getMachineFiles(machineId: number, search = '') {
    return this.http.get<any>(`${this.api}/machine/${machineId}/files`, {
      params: search ? { search } : {}
    });
  }

  /** Is the controller reachable right now? */
  getMachineStatus(machineId: number) {
    return this.http.get<any>(`${this.api}/machine/${machineId}/status`);
  }

  /** Pull a program off the controller into the server library. */
  fetchFromMachine(machineId: number, fileName: string) {
    return this.http.post<any>(`${this.api}/machine/${machineId}/fetch`, { file_name: fileName });
  }

  getTransfers(params: any = {}) {
    return this.http.get<any>(`${this.api}/transfers`, { params });
  }

  /** Programs read off a machine just before an overwrite replaced them.
   *  Kept out of the main program list, so this is where they are found. */
  getBackups(params: { machine_id?: number | null; page?: number; limit?: number } = {}) {
    const query: any = {};
    if (params.machine_id) query.machine_id = params.machine_id;
    if (params.page)       query.page       = params.page;
    if (params.limit)      query.limit      = params.limit;
    return this.http.get<any>(`${this.api}/backups`, { params: query });
  }

  /** Test the connection to a machine — FTP or FOCAS, whichever it uses.
   *  Blank password falls back to the stored one when machine_id is given
   *  (the password is write-only). */
  testConnection(config: { machine_id?: number; ip_address?: string; ftp_port?: number;
                           ftp_user?: string; ftp_pass?: string }) {
    return this.http.post<any>(`${this.api}/test-connection`, config);
  }
}
