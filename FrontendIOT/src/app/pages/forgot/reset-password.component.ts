import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from "@angular/forms";
import { ActivatedRoute, Router, RouterModule } from "@angular/router";
import { AuthService } from "../../core/services/auth.service";

function passwordMatchValidator(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirm = group.get('confirm_password')?.value;
  return password && confirm && password !== confirm ? { passwordMismatch: true } : null;
}

@Component({
  standalone: true,
  selector: 'app-reset-password',
  templateUrl: './reset-password.component.html',
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  styleUrls: ['./reset-password.component.scss']
})
export class ResetPasswordComponent {

  token!: string;
  message = '';
  success = false;
  showPassword = false;
  showConfirm = false;

  form = new FormGroup({
    password: new FormControl('', [Validators.required, Validators.minLength(8)]),
    confirm_password: new FormControl('', [Validators.required])
  }, { validators: passwordMatchValidator });

  constructor(
    private route: ActivatedRoute,
    private auth: AuthService,
    private router: Router
  ) {
    this.token = this.route.snapshot.params['token'];
  }

  submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.auth.resetPassword(this.token, this.form.value.password!)
      .subscribe({
        next: (res: any) => {
          this.message = 'Password reset successful. Redirecting to login...';
          this.success = true;
          setTimeout(() => this.router.navigate(['/login']), 2000);
        },
        error: (err) => {
          this.message = err.error?.message || 'Reset failed';
        }
      });
  }
}
