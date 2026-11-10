import { useEffect, useState } from 'react';
import { fetchDevelopmentEnvironment } from '@/features/development/api/developmentApi';
import type { PlatformEnvironmentVariable } from '@/features/platform/types/PlatformEnvironmentVariable';
import { useLiveStore } from '@/stores/liveStore';

interface UseDevelopmentEnvironment {
  variables: PlatformEnvironmentVariable[] | null;
  error: string | null;
}

/** The project's shared development variables: loaded once per mount, then live as any session, agent or device changes them. */
export const useDevelopmentEnvironment = (projectId: string): UseDevelopmentEnvironment => {
  const [state, setState] = useState<UseDevelopmentEnvironment>({ variables: null, error: null });

  useEffect(() => {
    let active = true;
    fetchDevelopmentEnvironment(projectId)
      .then(({ environment }) => { if (active) setState({ variables: environment, error: null }); })
      .catch((failure: Error) => { if (active) setState({ variables: [], error: failure.message }); });
    return () => { active = false; };
  }, [projectId]);

  const announced = useLiveStore((live) => live.developmentEnvironments[projectId]);
  return announced ? { variables: announced, error: null } : state;
};
