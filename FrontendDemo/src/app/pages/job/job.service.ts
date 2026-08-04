import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class JobService {
    private api = environment.apiUrl;

    constructor(private http: HttpClient) { }

    getJobs() {
        return this.http.get(`${this.api}/jobs/current`);
    }

    getJobHistory() {
        return this.http.get(`${this.api}/jobs/history`);
    }

    startJob(data: any) {
        return this.http.post(`${this.api}/jobs/start`, data);
    }

    stopJob(machine_id: number) {
        return this.http.post(`${this.api}/jobs/stop`, { machine_id });
    }

    deleteJob(id: number) {
        return this.http.delete(`${this.api}/jobs/` + id);
    }
    getMachines() {
        return this.http.get(`${this.api}/machines`);
    }

    getAvailableMachines() {
        return this.http.get(`${this.api}/jobs/available-machines`);
    }

    getOperators() {
        return this.http.get(`${this.api}/operators`);
    }

    getComponents(machine_id?: number) {
        const params = machine_id ? `?machine_id=${machine_id}&limit=100` : '?limit=100';
        return this.http.get(`${this.api}/components${params}`);
    }

}