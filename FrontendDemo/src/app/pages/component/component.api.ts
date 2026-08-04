import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ComponentApi {
    private api = environment.apiUrl;

    constructor(private http: HttpClient) { }

    list(page: number, limit: number, search: string) {
        return this.http.get<any>(`${this.api}/components?page=${page}&limit=${limit}&search=${search}`);
    }
    create(data: any) {
        return this.http.post<any>(`${this.api}/components`, data);
    }

    update(id: number, data: any) {
        return this.http.put<any>(`${this.api}/components/${id}`, data);
    }

    delete(id: number) {
        return this.http.delete<any>(`${this.api}/components/${id}`);
    }
    getMachines() {
        return this.http.get<any>(`${this.api}/master/machines`);
    }
}