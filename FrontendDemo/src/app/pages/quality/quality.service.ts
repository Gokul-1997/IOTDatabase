import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class QualityService {

    private api = environment.apiUrl;

    constructor(private http: HttpClient) { }

    getLines() {
        return this.http.get<any>(`${this.api}/lines`);
    }

    getMachines(line_id: number) {
        // FIX: was calling /master/machines (wrong endpoint, doesn't filter by line)
        // Corrected to /master/machines-by-line which is the proper endpoint
        return this.http.get<any>(`${this.api}/master/machines-by-line`, {
            params: { line_id }
        });
    }

    getShifts() {
        return this.http.get<any>(`${this.api}/master/shifts`);
    }

    getDashboard(params: any) {
        return this.http.get<any>(`${this.api}/quality`, {
            params
        });
    }
    getMachinesByLine(line_id: number) {
        return this.http.get<any>(`${this.api}/master/machines-by-line`, {
            params: { line_id }
        });
    }

    saveQuality(payload: { machine_id: number; shift_id: number; date: string; reject_qty: number; rework_qty: number }) {
        return this.http.post<any>(`${this.api}/quality/entry`, payload);
    }
}