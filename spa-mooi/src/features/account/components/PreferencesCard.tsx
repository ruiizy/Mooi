import { MoonStar, Sun } from 'lucide-react';
import { Card } from '@/shared/components/Card';
import { SegmentedControl } from '@/shared/components/SegmentedControl';
import type { SegmentItem } from '@/shared/types/SegmentItem';
import type { Theme } from '@/shared/types/Theme';
import { useThemeStore } from '@/stores/themeStore';

const themes: SegmentItem[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: MoonStar },
];

export const PreferencesCard = () => {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-sm font-semibold tracking-[-0.015em] text-ink">Preferences</h2>

      <p className="mt-4 text-[13px] font-bold text-ink">Appearance</p>

      <div className="sm:flex sm:items-center sm:justify-between sm:gap-6">
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
          The preference is per device: it does not travel with your account.
        </p>

        <SegmentedControl
          items={themes}
          value={theme}
          onChange={(id) => setTheme(id as Theme)}
          className="mt-4 flex w-full sm:mt-0 sm:w-auto sm:shrink-0"
        />
      </div>
    </Card>
  );
};
