import { RefreshCw, SearchX } from 'lucide-react';
import { RecipeListItem } from '@/features/recipes/components/RecipeListItem';
import type { MarketplaceRecipes } from '@/features/recipes/types/MarketplaceRecipes';
import type { Recipe } from '@/features/recipes/types/Recipe';
import { Button } from '@/shared/components/Button';

interface RecipeListProps {
  state: MarketplaceRecipes;
  recipes: Recipe[];
  selectedSlug: string | null;
  emptyHint: string;
  onSelect: (slug: string) => void;
  onRetry: () => void;
}

/** Every state of a marketplace read — first load, failure, empty, no match — rendered in place of the list. */
export const RecipeList = ({ state, recipes, selectedSlug, emptyHint, onSelect, onRetry }: RecipeListProps) => {
  if (state.status === 'error' && state.recipes.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 p-2">
        <p role="alert" className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}><RefreshCw className="size-4" /> Try again</Button>
      </div>
    );
  }

  if (state.recipes.length === 0 && state.status !== 'ready') {
    return (
      <ul aria-label="Loading recipes" className="flex animate-pulse-soft flex-col gap-2 p-1">
        {[0, 1, 2, 3].map((index) => <li key={index} className="h-16 rounded-xl bg-surface-2" />)}
      </ul>
    );
  }

  if (state.recipes.length === 0) {
    return <p className="p-3 text-sm leading-relaxed text-ink-muted">{emptyHint}</p>;
  }

  if (recipes.length === 0) {
    return (
      <p className="flex items-center gap-2 p-3 text-sm text-ink-muted">
        <SearchX className="size-4 shrink-0" aria-hidden="true" /> No recipe matches your search.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1 p-1">
      {recipes.map((recipe) => (
        <RecipeListItem key={recipe.slug} recipe={recipe} selected={recipe.slug === selectedSlug}
          onSelect={() => onSelect(recipe.slug)} />
      ))}
    </ul>
  );
};
