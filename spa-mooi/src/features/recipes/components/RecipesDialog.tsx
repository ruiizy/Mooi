import { useMemo, useState } from 'react';
import { ChefHat, LoaderCircle, RefreshCw } from 'lucide-react';
import { RecipeList } from '@/features/recipes/components/RecipeList';
import { RecipeMarketplaceChips } from '@/features/recipes/components/RecipeMarketplaceChips';
import { RecipePreview } from '@/features/recipes/components/RecipePreview';
import { useMarketplaceRecipes } from '@/features/recipes/hooks/useMarketplaceRecipes';
import { matchesRecipeQuery } from '@/features/recipes/lib/matchesRecipeQuery';
import { recipePrompt } from '@/features/recipes/lib/recipePrompt';
import { Button } from '@/shared/components/Button';
import { Modal } from '@/shared/components/Modal';
import { SearchInput } from '@/shared/components/SearchInput';
import { iconAction } from '@/shared/styles/iconAction';
import { cn } from '@/shared/utils/cn';
import { useRecipesStore } from '@/stores/recipesStore';

interface RecipesDialogProps {
  onClose: () => void;
  initialMarketplaceId?: string;
  /** Present in a session: the dialog becomes a picker that sends the chosen recipe to the agent. */
  onApply?: (prompt: string) => Promise<boolean>;
  applyDisabled?: boolean;
}

/**
 * Browse the recipes of the linked marketplaces and, inside a session, apply one. A two-pane
 * master-detail on wide screens; on small ones the preview replaces the list.
 */
export const RecipesDialog = ({ onClose, initialMarketplaceId, onApply, applyDisabled = false }: RecipesDialogProps) => {
  const marketplaces = useRecipesStore((state) => state.marketplaces);
  const [marketplaceId, setMarketplaceId] = useState(initialMarketplaceId ?? marketplaces[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [applying, setApplying] = useState(false);
  const state = useMarketplaceRecipes(marketplaceId);
  const marketplace = marketplaces.find((entry) => entry.id === marketplaceId) ?? null;
  const visible = useMemo(() => state.recipes.filter((recipe) => matchesRecipeQuery(recipe, query)), [state.recipes, query]);
  const selected = state.recipes.find((recipe) => recipe.slug === selectedSlug) ?? null;

  const changeMarketplace = (id: string) => {
    setMarketplaceId(id);
    setSelectedSlug(null);
  };

  const apply = async () => {
    if (!onApply || !selected || !marketplace) return;
    setApplying(true);
    const sent = await onApply(recipePrompt(selected, marketplace, notes));
    setApplying(false);
    if (sent) onClose();
  };

  return (
    <Modal open onClose={onClose} size="xl" title={onApply ? 'Apply a recipe' : 'Recipes'}
      description={onApply
        ? 'Pick a recipe and the agent adapts it to this project. Applying one again reviews and completes it.'
        : 'Reusable implementation recipes from your marketplaces.'}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{onApply ? 'Cancel' : 'Close'}</Button>
        {onApply ? (
          <Button variant="brand" onClick={() => void apply()} disabled={!selected || applying || applyDisabled}>
            {applying ? <LoaderCircle className="size-4 animate-spin" /> : <ChefHat className="size-4" />}
            Apply recipe
          </Button>
        ) : null}
      </>}>
      <div className="flex flex-col gap-4">
        {marketplaces.length > 1 ? <RecipeMarketplaceChips marketplaces={marketplaces} value={marketplaceId} onChange={changeMarketplace} /> : null}

        <div className="flex items-center gap-2">
          <SearchInput value={query} onChange={setQuery} placeholder="Search recipes" />
          <button type="button" onClick={state.reload} disabled={state.status === 'loading'}
            aria-label="Refresh recipes" title="Refresh recipes" className={iconAction}>
            <RefreshCw className={cn('size-4', state.status === 'loading' && 'animate-spin')} />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:h-[min(62dvh,36rem)] lg:min-h-0 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
          <nav aria-label="Recipes" className={cn('rounded-xl border border-line lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain', selected && 'hidden lg:block')}>
            <RecipeList state={state} recipes={visible} selectedSlug={selectedSlug} onSelect={setSelectedSlug} onRetry={state.reload}
              emptyHint={`No recipes yet. Add Markdown files to the recipes folder of ${marketplace?.fullName ?? 'this repository'}.`} />
          </nav>

          <section aria-label="Recipe preview" className={cn('flex flex-col gap-3 lg:min-h-0', !selected && 'hidden lg:flex')}>
            <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
              <RecipePreview recipe={selected} onBack={() => setSelectedSlug(null)} />
            </div>
            {onApply && selected ? (
              <label className="flex shrink-0 flex-col gap-1.5">
                <span className="text-xs font-semibold text-ink-muted">Additional instructions <span className="font-normal text-ink-subtle">(optional)</span></span>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={4000}
                  placeholder="e.g. Only the backend part, keep the current login screen"
                  className="resize-none rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-subtle focus:border-brand" />
              </label>
            ) : null}
          </section>
        </div>

        {state.status === 'error' && state.recipes.length > 0 ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
      </div>
    </Modal>
  );
};
