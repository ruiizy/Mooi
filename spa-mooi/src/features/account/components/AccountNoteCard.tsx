import { Card } from '@/shared/components/Card';

export const AccountNoteCard = () => (
  <Card className="bg-surface-2 p-5">
    <h2 className="text-sm font-semibold tracking-[-0.015em] text-ink">Always reversible</h2>
    <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
      Everything you connect or import — your GitHub account, an agent credential, a repository, a
      session — you can withdraw yourself. Withdrawing it in Mooi never changes anything outside Mooi.
    </p>
  </Card>
);
