import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-icon',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './icon.html'
})
export class IconComponent {
  @Input() name!: string;
  @Input() size: number = 24;
  @Input() color: string = '';
}