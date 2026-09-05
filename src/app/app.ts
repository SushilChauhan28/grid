import { Component } from '@angular/core';
import { CscGridComponent } from './csc-grid/csc-grid.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CscGridComponent],
  template: `<app-csc-grid accentColorProp="Teal" densityProp="Standard" [zebraProp]="true"></app-csc-grid>`,
})
export class App {}
