import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule, FormGroup } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { finalize } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';



@Component({

    selector: 'app-login',
    standalone: true,

    imports: [
        CommonModule,
        ReactiveFormsModule,
        RouterModule
    ],

    templateUrl: './login.component.html',
    styleUrls: ['./login.component.scss']

})

export class LoginComponent
    implements OnInit, OnDestroy {


    // LOGIN
    loading = false;
    error = '';
    form!: FormGroup;

    // CAROUSEL
    currentSlide = 0;
    intervalId: any;


    // swipe
    startX = 0;
    endX = 0;
    isDragging = false;

    slides = [
        {
            image: '/images/product/machine_login_02.png',
            title: 'Access your IoT Dashboard',
            desc: 'Monitor machines and production live'
        },

        {
            image: '/images/product/machine_login_02.png',
            title: 'Track OEE Performance',
            desc: 'Availability, Quality and Efficiency'
        },

        {
            image: '/images/product/machine_login_02.png',
            title: 'Smart Factory Control',
            desc: 'Real time monitoring and alerts'
        }

    ];

    showPassword = false;


    constructor(
        private fb: FormBuilder,
        private auth: AuthService,
        private router: Router,
        private cdr: ChangeDetectorRef
    ) { }

    isDark = false;


    ////////////////////////////////////////////
    // INIT
    ////////////////////////////////////////////

    ngOnInit(): void {
        this.form = this.fb.group({
            email: ['', [Validators.required, Validators.email]],
            password: ['', [Validators.required, Validators.minLength(6)]]
        });


        this.startCarousel();
        this.isDark =
            document.documentElement.classList.contains('dark');
    }

    ////////////////////////////////////////////
    // TOGGLE DARK & LIGHT
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
    // DESTROY
    ////////////////////////////////////////////

    ngOnDestroy(): void {
        this.pauseCarousel();
    }



    ////////////////////////////////////////////
    // CAROUSEL AUTO PLAY
    ////////////////////////////////////////////

    startCarousel() {
        this.pauseCarousel();
        this.intervalId = setInterval(() => {
            this.nextSlide();
        }, 4000);
    }


    pauseCarousel() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    }


    resumeCarousel() {
        this.startCarousel();
    }



    ////////////////////////////////////////////
    // SLIDE CONTROL
    ////////////////////////////////////////////

    nextSlide() {
        this.currentSlide =
            (this.currentSlide + 1)
            % this.slides.length;
    }


    prevSlide() {
        this.currentSlide =
            (this.currentSlide - 1 + this.slides.length)
            % this.slides.length;
    }


    goToSlide(index: number) {
        this.currentSlide = index;
    }



    ////////////////////////////////////////////
    // TOUCH EVENTS
    ////////////////////////////////////////////

    onTouchStart(event: any) {
        this.startX =
            event.touches[0].clientX;
    }


    onTouchEnd(event: any) {
        this.endX =
            event.changedTouches[0].clientX;
        this.handleSwipe();
    }
    togglePassword() {
        this.showPassword = !this.showPassword;
    }

    ////////////////////////////////////////////
    // MOUSE EVENTS
    ////////////////////////////////////////////

    onMouseDown(event: any) {
        this.isDragging = true;
        this.startX = event.clientX;
    }


    onMouseUp(event: any) {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.endX = event.clientX;
        this.handleSwipe();
    }



    ////////////////////////////////////////////
    // SWIPE LOGIC
    ////////////////////////////////////////////

    handleSwipe() {
        const diff =
            this.startX - this.endX;

        if (Math.abs(diff) < 50)
            return;

        if (diff > 0)
            this.nextSlide();
        else
            this.prevSlide();
    }



    ////////////////////////////////////////////
    // LOGIN
    ////////////////////////////////////////////

    submit() {
        this.form.markAllAsTouched();
        if (this.form.invalid) return;

        this.loading = true;
        this.error = '';

        this.auth.login(this.form.value)
            .pipe(finalize(() => {
                this.loading = false;
                this.cdr.detectChanges();
            }))
            .subscribe({
                next: () => {
                    this.router.navigate([this.auth.getFirstAccessibleRoute()]);
                },
                error: err => {
                    this.error = this.resolveError(err);
                    this.cdr.detectChanges();
                }
            });
    }

    private resolveError(err: any): string {
        switch (err.status) {
            case 0:
                return 'Unable to reach the server. Check your internet connection.';
            case 401:
                return err.error?.message || 'Invalid email or password.';
            case 403:
                return 'Your account has been deactivated. Please contact support.';
            case 429:
                return 'Too many login attempts. Please wait a moment and try again.';
            case 500:
            case 502:
            case 503:
                return 'Server error. Please try again later.';
            default:
                return err.error?.message || 'Login failed. Please try again.';
        }
    }


}