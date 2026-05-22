import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/services/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  constructor(private auth: AuthService) {}

  ngOnInit() {
  const token = localStorage.getItem('token');

  if (token) {
    this.auth.scheduleRefresh(token);
  }
}

}
