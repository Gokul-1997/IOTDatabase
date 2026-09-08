import { ChangeDetectorRef, Directive, ElementRef, HostListener, inject } from '@angular/core';
import { FormGroup } from '@angular/forms';

/**
 * Shared behaviour for every form dialog.
 *
 * The modals used to differ in more than looks: some closed on Escape,
 * most did not; none trapped focus, so tabbing past the last button walked
 * into the page behind, which is still rendered and clickable; and each one
 * spelled its "show this error yet?" check slightly differently.
 *
 * Uses inject() rather than constructor parameters so subclasses keep their
 * own constructors unchanged apart from the super() call.
 */
@Directive()
export abstract class DialogFormBase {

  private readonly hostRef = inject(ElementRef) as ElementRef<HTMLElement>;
  // Named distinctly: several dialogs already declare their own `cdr`,
  // and a private field of the same name in a base class is a type error.
  private readonly dialogCdr = inject(ChangeDetectorRef);

  /** What closing means for this dialog — usually `this.close.emit()`. */
  abstract dismiss(): void;

  /**
   * Ask for a re-render.
   *
   * The app runs zoneless (Angular 21, no zone.js), so assigning a field
   * inside an HTTP callback schedules nothing — a failed save would leave
   * its button stuck on "Saving…" until the user clicked elsewhere. Every
   * async callback in a dialog has to say it changed something.
   */
  protected touch(): void {
    this.dialogCdr.markForCheck();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.dismiss();
  }

  /**
   * Keep Tab inside the dialog. Without it focus escapes to the page
   * underneath, which the overlay hides but does not disable.
   */
  @HostListener('document:keydown.tab', ['$event'])
  @HostListener('document:keydown.shift.tab', ['$event'])
  onTab(rawEvent: Event): void {
    const event = rawEvent as KeyboardEvent;
    const focusable = Array.from(
      this.hostRef.nativeElement.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
        ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => el.offsetParent !== null);

    if (!focusable.length) return;

    const first  = focusable[0];
    const last   = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /**
   * Read the subclass's own `form` rather than declaring one here — every
   * dialog already declares `form!: FormGroup`, and a base declaration would
   * collide with all of them under noImplicitOverride.
   */
  private get formGroup(): FormGroup | undefined {
    const form = (this as { form?: FormGroup }).form;
    // A couple of dialogs drive a plain object with ngModel rather than a
    // reactive FormGroup; they never call invalid(), but guard anyway.
    return typeof form?.get === 'function' ? form : undefined;
  }

  /** Show an error once the user has left the field, not while typing. */
  invalid(name: string): boolean {
    const c = this.formGroup?.get(name);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  /** Move focus to the first field with an error after a failed save. */
  protected focusFirstInvalid(selectorByControl: Record<string, string>): void {
    const form = this.formGroup;
    const firstInvalid = Object.keys(form?.controls ?? {})
      .find(k => form!.get(k)?.invalid);
    if (!firstInvalid) return;

    const selector = selectorByControl[firstInvalid];
    if (!selector) return;

    const el = this.hostRef.nativeElement.querySelector<HTMLElement>(selector);
    el?.focus();
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /** Send focus into the dialog on open, so keyboard users start inside it. */
  protected focusFirstField(selector: string): void {
    setTimeout(() => this.hostRef.nativeElement.querySelector<HTMLElement>(selector)?.focus());
  }
}
