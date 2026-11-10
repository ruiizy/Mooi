import type { PlatformAgentCopy } from '@/features/platform/types/PlatformAgentCopy';
import type { ProductionAgentIntent } from '@/features/production/types/ProductionAgentIntent';

export const PRODUCTION_AGENT_COPY: Record<ProductionAgentIntent, PlatformAgentCopy> = {
  setup: {
    title: 'Deploy to production',
    description: 'Pick the agent and describe how this project should reach production. It prepares DEPLOYMENT.md, deploy.sh and status.sh with you in a chat.',
    label: 'How should it be deployed?',
    placeholder: 'For example: build the Docker image, push it to my registry and restart the service over SSH on my VPS. Serve it behind Caddy at app.example.com…',
    action: 'Start deployment setup',
  },
  update: {
    title: 'Change deployment settings',
    description: 'Describe what should change. The agent updates the deployment files; the new version goes live with the next successful deployment.',
    label: 'What should change?',
    placeholder: 'For example: move to a new host, add a database migration step, check /health instead of /…',
    action: 'Start update',
  },
  fix: {
    title: 'Fix the deployment',
    description: 'The agent reads the failed attempt, explains the cause and corrects the configuration with you.',
    label: 'Anything the agent should know? (optional)',
    placeholder: 'For example: the server was rebuilt yesterday, the SSH user changed…',
    action: 'Start fixing',
  },
};

export const PRODUCTION_AGENT_SUGGESTIONS = [
  'Docker Compose on my server over SSH',
  'Static build published to GitHub Pages',
  'Container image deployed to Fly.io',
  'Cloud Run on GCP with Cloud SQL',
];
