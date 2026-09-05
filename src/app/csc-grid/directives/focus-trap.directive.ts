import { Directive, ElementRef, AfterViewInit, OnDestroy, Renderer2, Input, NgZone } from '@angular/core';

@Directive({ selector: '[focusTrap]', standalone: true })
export class FocusTrapDirective implements AfterViewInit, OnDestroy {
  @Input() focusTrapActive = true;
  private removeListener!: () => void;

  constructor(private el: ElementRef<HTMLElement>, private r: Renderer2, private zone: NgZone) {}

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.removeListener = this.r.listen(this.el.nativeElement, 'keydown', (e: KeyboardEvent) => this.onKey(e));
    });
  }
  ngOnDestroy(): void { this.removeListener?.(); }

  trapFocus(): void { this.focusables()[0]?.focus(); }

  private onKey(e: KeyboardEvent): void {
    if (!this.focusTrapActive || e.key !== 'Tab') return;
    const list = this.focusables();
    if (!list.length) return;
    const first = list[0], last = list[list.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first) { e.preventDefault(); e.stopPropagation(); last.focus(); }
    } else {
      if (active === last) { e.preventDefault(); e.stopPropagation(); first.focus(); }
    }
  }

  private focusables(): HTMLElement[] {
    return Array.from(this.el.nativeElement.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter(el => {
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden';
    });
  }
}
