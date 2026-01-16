import type {
  AgentBackend,
  AgentMessage,
  AgentMessageHandler,
  SessionId,
  StartSessionResult,
} from '../agent/core';
import { OpenCodeClient } from './client';
import type { OpenCodeEvent, OpenCodeMessagePart } from './types';

export interface OpenCodeBackendOptions {
  serverUrl?: string;
  password?: string;
  cwd?: string;
}

export class OpenCodeBackend implements AgentBackend {
  private client: OpenCodeClient;
  private messageHandlers: Set<AgentMessageHandler> = new Set();
  private currentSessionId: string | null = null;
  private eventUnsubscribe: (() => void) | null = null;
  private responseComplete: Promise<void> | null = null;
  private responseResolve: (() => void) | null = null;

  constructor(options: OpenCodeBackendOptions = {}) {
    this.client = new OpenCodeClient({
      serverUrl: options.serverUrl,
      password: options.password,
    });
  }

  async startSession(initialPrompt?: string): Promise<StartSessionResult> {
    const session = await this.client.createSession();
    this.currentSessionId = session.id;

    this.eventUnsubscribe = this.client.connectToEvents((event) => {
      this.handleOpenCodeEvent(event);
    });

    this.emit({ type: 'status', status: 'running' });

    if (initialPrompt) {
      await this.sendPrompt(session.id, initialPrompt);
    }

    return { sessionId: session.id };
  }

  async sendPrompt(sessionId: SessionId, prompt: string): Promise<void> {
    this.responseComplete = new Promise((resolve) => {
      this.responseResolve = resolve;
    });

    const parts: OpenCodeMessagePart[] = [{ type: 'text', text: prompt }];

    this.emit({ type: 'status', status: 'running' });

    await this.client.sendMessage(sessionId, parts, (chunk) => {
      this.handleStreamChunk(chunk);
    });

    this.emit({ type: 'status', status: 'idle' });

    if (this.responseResolve) {
      this.responseResolve();
      this.responseResolve = null;
    }
  }

  async cancel(sessionId: SessionId): Promise<void> {
    await this.client.abortSession(sessionId);
    this.emit({ type: 'status', status: 'idle' });
  }

  onMessage(handler: AgentMessageHandler): void {
    this.messageHandlers.add(handler);
  }

  offMessage(handler: AgentMessageHandler): void {
    this.messageHandlers.delete(handler);
  }

  async respondToPermission(requestId: string, approved: boolean): Promise<void> {
    this.emit({ type: 'permission-response', id: requestId, approved });
  }

  async waitForResponseComplete(timeoutMs = 120000): Promise<void> {
    if (!this.responseComplete) return;

    const timeout = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Response timeout')), timeoutMs);
    });

    await Promise.race([this.responseComplete, timeout]);
  }

  async dispose(): Promise<void> {
    if (this.eventUnsubscribe) {
      this.eventUnsubscribe();
      this.eventUnsubscribe = null;
    }
    this.client.disconnect();
    this.messageHandlers.clear();
    this.emit({ type: 'status', status: 'stopped' });
  }

  private emit(message: AgentMessage): void {
    for (const handler of this.messageHandlers) {
      handler(message);
    }
  }

  private handleStreamChunk(chunk: string): void {
    try {
      const data = JSON.parse(chunk);
      this.processOpenCodeData(data);
    } catch {
      if (chunk.trim()) {
        this.emit({ type: 'model-output', textDelta: chunk });
      }
    }
  }

  private handleOpenCodeEvent(event: OpenCodeEvent): void {
    if (event.sessionId && event.sessionId !== this.currentSessionId) {
      return;
    }
    this.processOpenCodeData(event);
  }

  private processOpenCodeData(data: Record<string, unknown>): void {
    const eventType = data.type as string;

    switch (eventType) {
      case 'text':
      case 'token':
      case 'content':
        this.emit({
          type: 'model-output',
          textDelta: (data.content || data.text || data.delta) as string,
        });
        break;

      case 'tool_call':
      case 'tool-call':
        this.emit({
          type: 'tool-call',
          toolName: data.name as string || data.toolName as string || 'unknown',
          args: (data.arguments || data.args || {}) as Record<string, unknown>,
          callId: (data.id || data.callId || crypto.randomUUID()) as string,
        });
        break;

      case 'tool_result':
      case 'tool-result':
        this.emit({
          type: 'tool-result',
          toolName: data.name as string || data.toolName as string || 'unknown',
          result: data.result || data.output,
          callId: (data.id || data.callId || '') as string,
        });
        break;

      case 'file_edit':
      case 'fs-edit':
        this.emit({
          type: 'fs-edit',
          description: (data.description || data.summary || '') as string,
          diff: data.diff as string | undefined,
          path: data.path as string | undefined,
        });
        break;

      case 'terminal':
      case 'terminal-output':
        this.emit({
          type: 'terminal-output',
          data: (data.output || data.data || '') as string,
        });
        break;

      case 'permission_request':
      case 'permission-request':
        this.emit({
          type: 'permission-request',
          id: (data.id || crypto.randomUUID()) as string,
          reason: (data.reason || data.message || '') as string,
          payload: data.payload || data,
        });
        break;

      case 'error':
        this.emit({
          type: 'status',
          status: 'error',
          detail: (data.message || data.error || 'Unknown error') as string,
        });
        break;

      case 'done':
      case 'complete':
      case 'finished':
        this.emit({ type: 'status', status: 'idle' });
        break;

      default:
        if (data.text || data.content) {
          this.emit({
            type: 'model-output',
            textDelta: (data.text || data.content) as string,
          });
        }
    }
  }
}
