import { Check } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

const STEPS = [
  { title: 'Describe it', description: 'Pick an agent and explain how the project reaches production.' },
  { title: 'Prepare it together', description: 'The agent writes DEPLOYMENT.md, deploy.sh and status.sh and asks for any secret it needs.' },
  { title: 'Deploy a release', description: 'Choose a GitHub release, follow the console and keep an eye on its status.' },
];

/** The three-step setup path, with the current step highlighted. */
export const ProductionSteps = ({ current }: { current: number }) => (
  <ol className="grid gap-3 sm:grid-cols-3">
    {STEPS.map((step, index) => {
      const done = index < current;
      const active = index === current;
      return <li key={step.title} className={cn('flex gap-3 rounded-xl border p-3.5 transition',
        active ? 'border-line-strong bg-surface' : 'border-line bg-surface-2/60')}>
        <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold',
          done ? 'bg-success-soft text-success' : active ? 'bg-contrast text-contrast-ink' : 'bg-surface-3 text-ink-subtle')}>
          {done ? <Check className="size-3.5" /> : index + 1}
        </span>
        <span className="min-w-0">
          <span className={cn('block text-sm font-bold', active || done ? 'text-ink' : 'text-ink-muted')}>{step.title}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{step.description}</span>
        </span>
      </li>;
    })}
  </ol>
);
