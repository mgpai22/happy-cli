import {
  DEFAULT_OPENCODE_SERVER_URL,
  OPENCODE_HEALTH_ENDPOINT,
  OPENCODE_SESSION_ENDPOINT,
  OPENCODE_EVENT_ENDPOINT,
} from './constants';
import type {
  OpenCodeSession,
  OpenCodeHealthResponse,
  OpenCodeSessionCreateResponse,
  OpenCodeMessagePart,
  OpenCodeEvent,
} from './types';

export interface OpenCodeClientConfig {
  serverUrl?: string;
  password?: string;
}

export class OpenCodeClient {
  private serverUrl: string;
  private password?: string;
  private eventSource: EventSource | null = null;
  private eventHandlers: Set<(event: OpenCodeEvent) => void> = new Set();

  constructor(config: OpenCodeClientConfig = {}) {
    this.serverUrl = config.serverUrl || DEFAULT_OPENCODE_SERVER_URL;
    this.password = config.password;
  }

  private getAuthHeader(): Record<string, string> {
    if (!this.password) return {};
    const credentials = Buffer.from(`opencode:${this.password}`).toString('base64');
    return { Authorization: `Basic ${credentials}` };
  }

  async checkHealth(): Promise<OpenCodeHealthResponse> {
    const response = await fetch(`${this.serverUrl}${OPENCODE_HEALTH_ENDPOINT}`, {
      headers: this.getAuthHeader(),
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    return response.json() as Promise<OpenCodeHealthResponse>;
  }

  async isServerRunning(): Promise<boolean> {
    try {
      await this.checkHealth();
      return true;
    } catch {
      return false;
    }
  }

  async createSession(): Promise<OpenCodeSessionCreateResponse> {
    const response = await fetch(`${this.serverUrl}${OPENCODE_SESSION_ENDPOINT}`, {
      method: 'POST',
      headers: {
        ...this.getAuthHeader(),
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.status}`);
    }

    return response.json() as Promise<OpenCodeSessionCreateResponse>;
  }

  async getSession(sessionId: string): Promise<OpenCodeSession> {
    const response = await fetch(`${this.serverUrl}${OPENCODE_SESSION_ENDPOINT}/${sessionId}`, {
      headers: this.getAuthHeader(),
    });

    if (!response.ok) {
      throw new Error(`Failed to get session: ${response.status}`);
    }

    return response.json() as Promise<OpenCodeSession>;
  }

  async listSessions(): Promise<OpenCodeSession[]> {
    const response = await fetch(`${this.serverUrl}${OPENCODE_SESSION_ENDPOINT}`, {
      headers: this.getAuthHeader(),
    });

    if (!response.ok) {
      throw new Error(`Failed to list sessions: ${response.status}`);
    }

    const data = await response.json() as { sessions?: OpenCodeSession[] };
    return data.sessions || [];
  }

  async sendMessage(
    sessionId: string,
    parts: OpenCodeMessagePart[],
    onChunk?: (chunk: string) => void
  ): Promise<void> {
    const response = await fetch(
      `${this.serverUrl}${OPENCODE_SESSION_ENDPOINT}/${sessionId}/message`,
      {
        method: 'POST',
        headers: {
          ...this.getAuthHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parts }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim() && onChunk) {
          onChunk(line);
        }
      }
    }

    if (buffer.trim() && onChunk) {
      onChunk(buffer);
    }
  }

  async abortSession(sessionId: string): Promise<void> {
    const response = await fetch(
      `${this.serverUrl}${OPENCODE_SESSION_ENDPOINT}/${sessionId}/abort`,
      {
        method: 'POST',
        headers: this.getAuthHeader(),
      }
    );

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to abort session: ${response.status}`);
    }
  }

  connectToEvents(onEvent: (event: OpenCodeEvent) => void): () => void {
    this.eventHandlers.add(onEvent);

    if (!this.eventSource) {
      const url = `${this.serverUrl}${OPENCODE_EVENT_ENDPOINT}`;
      
      if (typeof EventSource !== 'undefined') {
        this.eventSource = new EventSource(url);
        
        this.eventSource.onmessage = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data) as OpenCodeEvent;
            for (const handler of this.eventHandlers) {
              handler(data);
            }
          } catch {
            /* parse error - skip malformed event */
          }
        };

        this.eventSource.onerror = () => {
          /* EventSource handles reconnection automatically */
        };
      }
    }

    return () => {
      this.eventHandlers.delete(onEvent);
      if (this.eventHandlers.size === 0 && this.eventSource) {
        this.eventSource.close();
        this.eventSource = null;
      }
    };
  }

  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.eventHandlers.clear();
  }
}
