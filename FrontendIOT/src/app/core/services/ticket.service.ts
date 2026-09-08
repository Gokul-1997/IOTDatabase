import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class TicketService {
  private api = environment.apiUrl + '/tickets';
  constructor(private http: HttpClient) {}

  getTickets(params: any = {}) { return this.http.get<any>(`${this.api}`, { params }); }
  getTicketById(id: number) { return this.http.get<any>(`${this.api}/${id}`); }
  createTicket(data: any) { return this.http.post<any>(`${this.api}`, data); }
  updateTicket(id: number, data: any) { return this.http.put<any>(`${this.api}/${id}`, data); }
  updateStatus(id: number, status: string, note?: string) { return this.http.patch<any>(`${this.api}/${id}/status`, { status, note }); }
  assignTicket(id: number, assigned_to: number) { return this.http.patch<any>(`${this.api}/${id}/assign`, { assigned_to }); }
  getSummary() { return this.http.get<any>(`${this.api}/summary`); }
}
