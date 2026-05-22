import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class MachineShiftService {
  private api = environment.apiUrl + '/machine-shifts';

  constructor(private http: HttpClient) {}

  getByMachine(machineId: number) {
    return this.http.get<any[]>(`${this.api}/${machineId}`);
  }

  save(data: any) {
    return this.http.post(this.api, data);
  }
}
