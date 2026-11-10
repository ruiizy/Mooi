import type { LucideIcon } from 'lucide-react';

/** How a span kind looks: icon, label and token classes. */
export interface TraceKindStyle {
  icon: LucideIcon;
  label: string;
  /** Icon / text colour. */
  text: string;
  /** Soft chip background with its text colour. */
  chip: string;
  /** Waterfall bar and legend dot fill. */
  bar: string;
}
