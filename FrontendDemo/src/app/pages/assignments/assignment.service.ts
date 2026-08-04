import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AssignmentService {
  private api = environment.apiUrl + '/assignments';
  constructor(private http: HttpClient) {}

  assignOperatorMachine(data: any) {
    return this.http.post(`${this.api}/operator-machine`, data);
  }

  assignOperatorShift(data: any) {
    return this.http.post(`${this.api}/operator-shift`, data);
  }
}
