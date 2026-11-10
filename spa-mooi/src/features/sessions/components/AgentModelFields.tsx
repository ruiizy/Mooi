import { Link } from 'react-router-dom';
import { ROUTES } from '@/app/routes';
import { AgentAccountSelect } from '@/features/agents/components/AgentAccountSelect';
import { AgentAdapterSelect } from '@/features/sessions/components/AgentAdapterSelect';
import { SessionModelFields } from '@/features/sessions/components/SessionModelFields';
import type { AgentModelChoice } from '@/features/sessions/hooks/useAgentModelChoice';

interface AgentModelFieldsProps {
  choice: AgentModelChoice;
  /** Called when the user follows the link to add an agent account. */
  onLeave: () => void;
}

/** Agent account, adapter, model and effort pickers, or the way to add an account when there is none. */
export const AgentModelFields = ({ choice, onLeave }: AgentModelFieldsProps) => {
  const { connections, connectionId, setConnectionId, adapters, adapter, setAdapter, selectedProvider, model, effort,
    selectModel, setEffort, catalogError } = choice;

  if (connections.length === 0) {
    return (
      <div className="rounded-control border border-warning/30 bg-warning-soft px-4 py-3.5 text-sm leading-relaxed text-ink">
        <p>
          <span className="font-medium">Add an agent account first.</span>{' '}
          <span className="text-ink-muted">A session needs one to run.</span>
        </p>
        <Link
          to={`${ROUTES.account}?tab=agents`}
          onClick={onLeave}
          className="mt-2 inline-block font-medium text-brand underline-offset-4 hover:underline"
        >
          Go to account settings
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-2">
        <span className="text-xs font-medium text-ink-muted">Agent account</span>
        <AgentAccountSelect connections={connections} value={connectionId} onChange={setConnectionId} />
      </label>

      {adapters.length > 1 && <AgentAdapterSelect adapters={adapters} value={adapter} onChange={setAdapter} />}

      <SessionModelFields provider={selectedProvider} model={model} effort={effort}
        onModelChange={selectModel} onEffortChange={setEffort} />
      {selectedProvider && !selectedProvider.unavailable && !selectedProvider.defaultModel && selectedProvider.models.length > 0 && !model &&
        <p role="status" className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-ink">
          The configured default model is unavailable. Select a model to continue.
        </p>}
      {catalogError ? <p role="alert" className="text-sm text-danger">{catalogError}</p> :
        !selectedProvider ? <p role="status" className="text-xs text-ink-muted">Loading models…</p> : null}
    </div>
  );
};
