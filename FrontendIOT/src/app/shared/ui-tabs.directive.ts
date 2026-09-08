import { Directive, ElementRef, HostListener, inject } from '@angular/core';

/**
 * Keyboard behaviour for a `.ui-tabs` strip.
 *
 * A row of buttons is not a tab strip to anyone using a keyboard or a screen
 * reader: without this they must Tab through every tab to reach the panel,
 * and nothing announces how many there are or which is current. The WAI-ARIA
 * tabs pattern expects Left/Right (Home/End) to move between tabs, so that is
 * what this adds — put it on the element carrying role="tablist" and it finds
 * the tabs itself.
 *
 *   <div class="ui-tabs" role="tablist" uiTabs aria-label="Report type">
 *     <button role="tab" class="ui-tab" [attr.aria-selected]="…">…</button>
 *   </div>
 *
 * Activation stays on click/Enter/Space — the buttons' own behaviour — so
 * arrowing across the strip does not fire off a data load per keypress.
 */
@Directive({
  selector: '[uiTabs]',
  standalone: true
})
export class UiTabsDirective {

  private readonly host = inject(ElementRef) as ElementRef<HTMLElement>;

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;

    const tabs = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('[role="tab"]')
    ).filter(el => !el.hasAttribute('disabled'));
    if (tabs.length < 2) return;

    const current = tabs.indexOf(document.activeElement as HTMLElement);
    if (current === -1) return;

    let next = current;
    switch (event.key) {
      case 'ArrowRight': next = (current + 1) % tabs.length; break;
      case 'ArrowLeft':  next = (current - 1 + tabs.length) % tabs.length; break;
      case 'Home':       next = 0; break;
      case 'End':        next = tabs.length - 1; break;
    }

    event.preventDefault();
    tabs[next].focus();
    // Keep the focused tab on screen when the strip scrolls (Components can
    // have one tab per machine).
    tabs[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
