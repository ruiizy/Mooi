import { lazy, Suspense } from 'react';
import { ChefHat, ChevronLeft } from 'lucide-react';
import type { Recipe } from '@/features/recipes/types/Recipe';
import { GithubMark } from '@/shared/components/icons/GithubMark';
import { iconAction } from '@/shared/styles/iconAction';

const MarkdownContent = lazy(() => import('@/features/sessions/components/chat/MarkdownContent'));

interface RecipePreviewProps {
  recipe: Recipe | null;
  onBack: () => void;
}

/** The selected recipe as the agent will read it. On small screens it replaces the list, with a way back. */
export const RecipePreview = ({ recipe, onBack }: RecipePreviewProps) => {
  if (!recipe) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="flex size-11 items-center justify-center rounded-xl bg-surface-2 text-ink-subtle"><ChefHat className="size-5" /></span>
        <p className="text-sm text-ink-muted">Select a recipe to preview it.</p>
      </div>
    );
  }

  return (
    <article className="flex flex-col gap-4">
      <header className="flex items-start gap-3">
        <button type="button" onClick={onBack} aria-label="Back to recipes" title="Back to recipes" className={`${iconAction} lg:hidden`}>
          <ChevronLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere] text-ink">{recipe.name}</h3>
          {recipe.description ? <p className="mt-1 text-sm leading-relaxed text-ink-muted">{recipe.description}</p> : null}
          <p className="mt-1.5 truncate font-mono text-[11px] text-ink-subtle">{recipe.path}</p>
        </div>
        {recipe.htmlUrl ? (
          <a href={recipe.htmlUrl} target="_blank" rel="noreferrer" aria-label="Open on GitHub" title="Open on GitHub" className={iconAction}>
            <GithubMark className="size-4" />
          </a>
        ) : null}
      </header>
      <div className="min-w-0 rounded-xl border border-line bg-surface-2/50 p-4 text-sm leading-relaxed text-ink sm:p-5">
        <Suspense fallback={<pre className="whitespace-pre-wrap font-sans">{recipe.content}</pre>}>
          <MarkdownContent text={recipe.content} />
        </Suspense>
      </div>
    </article>
  );
};
