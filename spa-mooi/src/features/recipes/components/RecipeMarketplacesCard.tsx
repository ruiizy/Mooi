import { useState } from 'react';
import { ChefHat, Plus, RefreshCw } from 'lucide-react';
import { AddRecipeMarketplaceDialog } from '@/features/recipes/components/AddRecipeMarketplaceDialog';
import { RecipeMarketplaceRow } from '@/features/recipes/components/RecipeMarketplaceRow';
import { RecipesDialog } from '@/features/recipes/components/RecipesDialog';
import { useRecipeMarketplaces } from '@/features/recipes/hooks/useRecipeMarketplaces';
import type { RecipeMarketplace } from '@/features/recipes/types/RecipeMarketplace';
import { Button } from '@/shared/components/Button';
import { Card } from '@/shared/components/Card';
import { Modal } from '@/shared/components/Modal';

/** The account's recipe marketplaces: link, browse and remove the repositories sessions apply recipes from. */
export const RecipeMarketplacesCard = () => {
  const { marketplaces, status, error, busy, actionError, add, remove, reload, clearActionError } = useRecipeMarketplaces();
  const [adding, setAdding] = useState(false);
  const [browsing, setBrowsing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<RecipeMarketplace | null>(null);

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-[-0.015em] text-ink">Recipe marketplaces</h2>
          <p className="mt-1 text-xs text-ink-subtle">GitHub repositories of reusable recipes your sessions can apply.</p>
        </div>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => { clearActionError(); setAdding(true); }}>
          <Plus className="size-4" /> Add marketplace
        </Button>
      </div>

      {status === 'error' ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-danger">{error}</p>
          <Button variant="secondary" size="sm" onClick={reload}><RefreshCw className="size-4" /> Try again</Button>
        </div>
      ) : null}

      {status === 'loading' && marketplaces.length === 0 ? (
        <div className="mt-5 animate-pulse-soft space-y-3">
          {[0, 1].map((index) => <div key={index} className="h-16 rounded-xl bg-surface-2" />)}
        </div>
      ) : null}

      {status === 'ready' && marketplaces.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-line px-5 py-8 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-surface-2 text-ink-muted"><ChefHat className="size-5" /></span>
          <p className="mt-3 text-sm font-semibold text-ink">No marketplaces yet</p>
          <p className="mt-1 text-xs text-ink-muted">Add one to apply its recipes from any session.</p>
        </div>
      ) : null}

      {marketplaces.length > 0 ? (
        <ul className="mt-5 divide-y divide-line rounded-xl border border-line px-4 sm:px-5">
          {marketplaces.map((marketplace) => (
            <RecipeMarketplaceRow key={marketplace.id} marketplace={marketplace} busy={busy}
              onBrowse={() => setBrowsing(marketplace.id)} onRemove={() => { clearActionError(); setRemoving(marketplace); }} />
          ))}
        </ul>
      ) : null}

      {actionError && !adding && !removing ? <p role="alert" className="mt-4 text-sm text-danger">{actionError}</p> : null}

      {adding ? <AddRecipeMarketplaceDialog busy={busy} actionError={actionError} onClose={() => setAdding(false)} onAdd={add} /> : null}

      {browsing ? <RecipesDialog initialMarketplaceId={browsing} onClose={() => setBrowsing(null)} /> : null}

      <Modal open={removing !== null} onClose={() => setRemoving(null)} title="Remove marketplace"
        description={`Sessions stop offering the recipes of ${removing?.fullName ?? 'this repository'}. The repository on GitHub is not touched.`}
        footer={<>
          <Button variant="ghost" onClick={() => setRemoving(null)} disabled={busy}>Cancel</Button>
          <Button variant="danger" disabled={busy} onClick={() => {
            if (removing) void remove(removing.id).then((removed) => { if (removed) setRemoving(null); });
          }}>Remove</Button>
        </>}>
        {removing && actionError ? <p role="alert" className="text-sm text-danger">{actionError}</p> : <p className="text-sm text-ink-muted">You can link it again at any time.</p>}
      </Modal>
    </Card>
  );
};
