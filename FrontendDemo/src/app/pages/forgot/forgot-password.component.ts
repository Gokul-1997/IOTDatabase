import { Component, OnInit, OnDestroy, ChangeDetectorRef } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from "@angular/forms";
import { RouterModule } from "@angular/router";
import { AuthService } from "../../core/services/auth.service";



@Component({

    selector: 'app-forgot-password',
    standalone: true,

    imports: [
        CommonModule,
        ReactiveFormsModule,
        RouterModule
    ],

    templateUrl: './forgot-password.component.html',
    styleUrls: ['./forgot-password.component.scss']

})

export class ForgotPasswordComponent
    implements OnInit, OnDestroy {

    loading = false;
    message = '';
    error = '';
    isDark = false;


    ////////////////////////////////////////////
    // FORM
    ////////////////////////////////////////////

    form = new FormGroup({
        email: new FormControl('',
            [Validators.required, Validators.email])
    });


    ////////////////////////////////////////////
    // CAROUSEL
    ////////////////////////////////////////////

    currentSlide = 0;
    intervalId: any;

    slides = [
        {
            image: '/images/product/machine_login_02.png',
            title: 'Reset Password Securely',
            desc: 'Recover access to your dashboard'
        },

        {
            image: '/images/product/machine_login_02.png',
            title: 'Secure Authentication',
            desc: 'Your data stays protected'
        },

        {
            image: '/images/product/machine_login_02.png',
            title: 'Back to Production Fast',
            desc: 'Minimize downtime quickly'
        }

    ];



    constructor(
        private auth: AuthService,
            private cdr: ChangeDetectorRef

    ) { }


    ////////////////////////////////////////////
    // INIT
    ////////////////////////////////////////////

    ngOnInit(): void {

        this.startCarousel();
        this.isDark =
            document.documentElement.classList.contains('dark');
    }



    ////////////////////////////////////////////
    // DESTROY
    ////////////////////////////////////////////

    ngOnDestroy(): void {
        this.pauseCarousel();
    }


    ////////////////////////////////////////////
    // DARK MODE
    ////////////////////////////////////////////

    toggleDark() {
        this.isDark = !this.isDark;
        if (this.isDark) {
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        }
        else {

            document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');
        }

    }


    ////////////////////////////////////////////
    // CAROUSEL
    ////////////////////////////////////////////

    startCarousel() {

        this.pauseCarousel();
        this.intervalId = setInterval(() => {
            this.nextSlide();
        }, 4000);

    }

    pauseCarousel() {
        if (this.intervalId)
            clearInterval(this.intervalId);
    }


    nextSlide() {
        this.currentSlide =
            (this.currentSlide + 1)
            % this.slides.length;
    }

    goToSlide(index: number) {
        this.currentSlide = index;
    }


    ////////////////////////////////////////////
    // SUBMIT
    ////////////////////////////////////////////

submit() {
  if (this.form.invalid) return;

  this.loading = true;
  this.error = '';
  this.message = '';

  this.auth.forgotPassword(this.form.value.email!)
    .subscribe({
      next: (res: any) => {
        console.log("API response:", res);

        this.message = res.message;   // ✅ direct use
        this.error = '';
        this.loading = false;
                this.cdr.detectChanges();

      },
      error: (err) => {
        this.error =
          err.error?.message ||
          'Something went wrong';
        this.message = '';
        this.loading = false;
                this.cdr.detectChanges();

      }
    });
}

}