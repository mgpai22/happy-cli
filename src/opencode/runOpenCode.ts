import { render } from 'ink';
import React from 'react';
import { randomUUID } from 'node:crypto';

import { ApiClient } from '@/api/api';
import { logger } from '@/ui/logger';
import { Credentials, readSettings } from '@/persistence';
import { createSessionMetadata } from '@/utils/createSessionMetadata';
import { initialMachineMetadata } from '@/daemon/run';
import { projectPath } from '@/projectPath';
import { startHappyServer } from '@/claude/utils/startHappyServer';
import { MessageBuffer } from '@/ui/ink/messageBuffer';
import { notifyDaemonSessionStarted } from '@/daemon/controlClient';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import { stopCaffeinate } from '@/utils/caffeinate';
import { connectionState } from '@/utils/serverConnectionErrors';
import { setupOfflineReconnection } from '@/utils/setupOfflineReconnection';
import type { ApiSessionClient } from '@/api/apiSession';

import { createOpenCodeBackend } from './factory';
import { OpenCodeClient } from './client';
import type { AgentBackend, AgentMessage } from '@/agent';
import { OpenCodeDisplay } from './OpenCodeDisplay';
import {
  OPENCODE_SERVER_URL_ENV,
  OPENCODE_SERVER_PASSWORD_ENV,
  DEFAULT_OPENCODE_SERVER_URL,
} from './constants';

export async function runOpenCode(opts: {
  credentials: Credentials;
  startedBy?: 'daemon' | 'terminal';
}): Promise<void> {
  const sessionTag = randomUUID();

  connectionState.setBackend('OpenCode');

  const api = await ApiClient.create(opts.credentials);

  const settings = await readSettings();
  const machineId = settings?.machineId;
  if (!machineId) {
    console.error(`[START] No machine ID found in settings. Please run 'happy' first to set up.`);
    process.exit(1);
  }

  logger.debug(`Using machineId: ${machineId}`);
  await api.getOrCreateMachine({
    machineId,
    metadata: initialMachineMetadata
  });

  const serverUrl = process.env[OPENCODE_SERVER_URL_ENV] || DEFAULT_OPENCODE_SERVER_URL;
  const password = process.env[OPENCODE_SERVER_PASSWORD_ENV];

  const openCodeClient = new OpenCodeClient({ serverUrl, password });

  const isRunning = await openCodeClient.isServerRunning();
  if (!isRunning) {
    console.error(`\nOpenCode server is not running at ${serverUrl}`);
    console.error(`\nPlease start OpenCode in server mode first:`);
    console.error(`  opencode serve --hostname 0.0.0.0 --port 4096`);
    console.error(`\nOr set OPENCODE_SERVER_URL to point to your OpenCode server.`);
    process.exit(1);
  }

  logger.debug(`[OpenCode] Server is running at ${serverUrl}`);

  const { state, metadata } = createSessionMetadata({
    flavor: 'opencode',
    machineId,
    startedBy: opts.startedBy
  });
  const response = await api.getOrCreateSession({ tag: sessionTag, metadata, state });

  let session: ApiSessionClient;
  let isProcessingMessage = false;
  let pendingSessionSwap: ApiSessionClient | null = null;

  const applyPendingSessionSwap = () => {
    if (pendingSessionSwap) {
      session = pendingSessionSwap;
      pendingSessionSwap = null;
      logger.debug('[OpenCode] Applied pending session swap');
    }
  };

  const { session: initialSession } = setupOfflineReconnection({
    api,
    sessionTag,
    metadata,
    state,
    response,
    onSessionSwap: (newSession) => {
      if (isProcessingMessage) {
        pendingSessionSwap = newSession;
        logger.debug('[OpenCode] Queued session swap (processing in progress)');
      } else {
        session = newSession;
        logger.debug('[OpenCode] Applied session swap immediately');
      }
    }
  });
  session = initialSession;

  const { backend, serverUrl: resolvedServerUrl } = createOpenCodeBackend({
    cwd: projectPath(),
    serverUrl,
    password,
  });

  const messageBuffer = new MessageBuffer();

  backend.onMessage((msg) => {
    if (msg.type === 'model-output' && msg.textDelta) {
      messageBuffer.updateLastMessage(msg.textDelta, 'assistant');
    } else if (msg.type === 'tool-call') {
      messageBuffer.addMessage(`[Tool: ${msg.toolName}]`, 'tool');
    } else if (msg.type === 'tool-result') {
      messageBuffer.addMessage(`[Result: ${JSON.stringify(msg.result)}]`, 'result');
    } else if (msg.type === 'status') {
      messageBuffer.addMessage(`[Status: ${msg.status}]`, 'status');
    }
  });

  const happyServer = await startHappyServer(session);

  registerKillSessionHandler(session.rpcHandlerManager, async () => {
    await backend.dispose();
    stopCaffeinate();
  });

  if (response) {
    try {
      logger.debug(`[START] Reporting session ${response.id} to daemon`);
      const result = await notifyDaemonSessionStarted(response.id, metadata);
      if (result.error) {
        logger.debug(`[START] Failed to report to daemon (may not be running):`, result.error);
      } else {
        logger.debug(`[START] Reported session ${response.id} to daemon`);
      }
    } catch (error) {
      logger.debug('[START] Failed to report to daemon (may not be running):', error);
    }
  }

  const { unmount, waitUntilExit } = render(
    React.createElement(OpenCodeDisplay, {
      messageBuffer,
      serverUrl: resolvedServerUrl,
      onExit: async () => {
        await backend.dispose();
        stopCaffeinate();
        unmount();
      },
    })
  );

  await waitUntilExit();
}
