import { Injectable, Renderer2, RendererFactory2, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({ providedIn: 'root' })
export class A11yAnnounceService {
  private queue: string[] = [];
  private liveRegion!: HTMLElement;
  private busy = false;
  private readonly DWELL = 900;
  private renderer: Renderer2;

  constructor(rf: RendererFactory2, @Inject(PLATFORM_ID) private pid: object) {
    this.renderer = rf.createRenderer(null, null);
    if (isPlatformBrowser(this.pid)) this.createRegion();
  }

  announce(msg: string): void {
    if (!msg?.trim()) return;
    this.queue.push(msg);
    if (!this.busy) this.pump();
  }

  clear(): void {
    this.queue = []; this.busy = false;
    if (this.liveRegion) this.renderer.setProperty(this.liveRegion, 'textContent', '');
  }

  private createRegion(): void {
    const el = this.renderer.createElement('div');
    this.renderer.setAttribute(el, 'aria-live', 'polite');
    this.renderer.setAttribute(el, 'aria-atomic', 'true');
    this.renderer.setAttribute(el, 'role', 'status');
    const sr: Record<string,string> = { position:'absolute', width:'1px', height:'1px',
      padding:'0', margin:'-1px', overflow:'hidden', clip:'rect(0,0,0,0)',
      'white-space':'nowrap', border:'0' };
    Object.entries(sr).forEach(([k,v]) => this.renderer.setStyle(el, k, v));
    this.renderer.appendChild(document.body, el);
    this.liveRegion = el;
  }

  private async pump(): Promise<void> {
    this.busy = true;
    while (this.queue.length) {
      const msg = this.queue.shift()!;
      this.renderer.setProperty(this.liveRegion, 'textContent', '');
      await this.wait(50);
      this.renderer.setProperty(this.liveRegion, 'textContent', msg);
      await this.wait(this.DWELL);
    }
    this.busy = false;
  }

  private wait(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
}
