import type { AgentBackend, AgentFactoryOptions } from '../agent/core';
import { agentRegistry } from '../agent/core';
import { OpenCodeBackend } from './OpenCodeBackend';
import {
  OPENCODE_SERVER_URL_ENV,
  OPENCODE_SERVER_PASSWORD_ENV,
  DEFAULT_OPENCODE_SERVER_URL,
} from './constants';
import { logger } from '@/ui/logger';

export interface OpenCodeBackendOptions extends AgentFactoryOptions {
  serverUrl?: string;
  password?: string;
}

export interface OpenCodeBackendResult {
  backend: AgentBackend;
  serverUrl: string;
}

export function createOpenCodeBackend(options: OpenCodeBackendOptions): OpenCodeBackendResult {
  const serverUrl =
    options.serverUrl ||
    process.env[OPENCODE_SERVER_URL_ENV] ||
    DEFAULT_OPENCODE_SERVER_URL;

  const password =
    options.password ||
    process.env[OPENCODE_SERVER_PASSWORD_ENV];

  logger.debug('[OpenCode] Creating backend with options:', {
    cwd: options.cwd,
    serverUrl,
    hasPassword: !!password,
  });

  const backend = new OpenCodeBackend({
    serverUrl,
    password,
    cwd: options.cwd,
  });

  return { backend, serverUrl };
}

export function registerOpenCodeAgent(): void {
  agentRegistry.register('opencode', (opts) => createOpenCodeBackend(opts).backend);
  logger.debug('[OpenCode] Registered with agent registry');
}
