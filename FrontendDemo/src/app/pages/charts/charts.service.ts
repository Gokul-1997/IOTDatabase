import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ChartsService {
  private api = `${environment.apiUrl}/charts`;

  constructor(private http: HttpClient) {}

  getMeta() {
    return this.http.get<any>(`${this.api}/meta`);
  }

  getChartData(params: { machine_id?: number; shift_id?: number; date: string }) {
    return this.http.get<any>(`${this.api}/data`, { params: params as any });
  }

  getPartTiming(machineId: number, shiftStartEpoch: number, shiftEndEpoch?: number, maxParts?: number) {
    const params: any = { machine_id: machineId, shift_start_epoch: shiftStartEpoch };
    if (shiftEndEpoch) params.shift_end_epoch = shiftEndEpoch;
    if (maxParts)      params.max_parts       = maxParts;
    return this.http.get<any>(`${this.api}/parts`, { params });
  }
}
