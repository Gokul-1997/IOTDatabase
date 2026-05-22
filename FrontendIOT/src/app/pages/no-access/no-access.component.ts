import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-no-access',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-6">
      <div class="text-center max-w-md">
        <div class="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg class="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
          </svg>
        </div>
        <h1 class="text-2xl font-bold text-gray-800 dark:text-white mb-2">Access Denied</h1>
        <p class="text-gray-500 dark:text-gray-400 mb-8">
          You don't have permission to access this page.<br>
          Contact your administrator to request access.
        </p>
        <div class="flex flex-col sm:flex-row gap-3 justify-center">
          <button (click)="goBack()"
            class="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition">
            Go Back
          </button>
          <button (click)="logout()"
            class="px-6 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 font-medium transition">
            Logout
          </button>
        </div>
      </div>
    </div>
  `
})
export class NoAccessComponent {
  constructor(private router: Router, private auth: AuthService) {}

  goBack() {
    window.history.length > 1 ? window.history.back() : this.router.navigate(['/']);
  }

  logout() {
    this.auth.logout();
  }
}
