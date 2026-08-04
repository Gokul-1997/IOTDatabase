import { Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({ providedIn: 'root' })
export class ToastService {

  constructor(private snackBar: MatSnackBar) {}

  success(message: string) {
    this.snackBar.open(message, '✕', {
      duration: 3000,
      panelClass: ['toast-success'],
      horizontalPosition: 'right',
      verticalPosition: 'top'
    });
  }

  error(message: string) {
    this.snackBar.open(message, '✕', {
      duration: 4000,
      panelClass: ['toast-error'],
      horizontalPosition: 'right',
      verticalPosition: 'top'
    });
  }

  info(message: string) {
    this.snackBar.open(message, '✕', {
      duration: 3000,
      panelClass: ['toast-info'],
      horizontalPosition: 'right',
      verticalPosition: 'top'
    });
  }
}
