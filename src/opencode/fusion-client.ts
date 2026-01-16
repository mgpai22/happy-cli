import {
  OPENCODE_SERVER_URL_ENV,
  DEFAULT_OPENCODE_SERVER_URL,
} from './constants';

export const FUSION_API_URL_ENV = 'FUSION_API_URL';
export const FUSION_API_TOKEN_ENV = 'FUSION_API_TOKEN';
export const DEFAULT_FUSION_API_URL = 'http://localhost:8787';

export interface FusionSession {
  id: string;
  userId: string;
  name: string;
  status: 'pending' | 'provisioning' | 'starting' | 'active' | 'stopping' | 'stopped' | 'error';
  config: {
    repositoryUrl?: string;
    branch: string;
    serverType: string;
    location: string;
    maxRuntimeHours: number;
  };
  sandboxId?: string;
  sandboxIp?: string;
  openCodeSessionId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  stoppedAt?: string;
  error?: string;
}

export interface FusionHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  timestamp: string;
  services: Record<string, { status: 'up' | 'down' | 'unknown'; latencyMs?: number }>;
}

export interface FusionClientConfig {
  apiUrl?: string;
  token?: string;
}

export class FusionClient {
  private apiUrl: string;
  private token?: string;
  private ws: WebSocket | null = null;
  private eventHandlers: Set<(event: unknown) => void> = new Set();

  constructor(config: FusionClientConfig = {}) {
    this.apiUrl = config.apiUrl || process.env[FUSION_API_URL_ENV] || DEFAULT_FUSION_API_URL;
    this.token = config.token || process.env[FUSION_API_TOKEN_ENV];
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  async checkHealth(): Promise<FusionHealthResponse> {
    const response = await fetch(`${this.apiUrl}/health`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    return response.json() as Promise<FusionHealthResponse>;
  }

  async isServerRunning(): Promise<boolean> {
    try {
      const health = await this.checkHealth();
      return health.status === 'healthy';
    } catch {
      return false;
    }
  }

  async createSession(name: string, config?: Partial<FusionSession['config']>): Promise<FusionSession> {
    const response = await fetch(`${this.apiUrl}/session`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ name, config }),
    });

    if (!response.ok) {
      const error = await response.json() as { error?: { message?: string } };
      throw new Error(`Failed to create session: ${error?.error?.message || response.status}`);
    }

    return response.json() as Promise<FusionSession>;
  }

  async getSession(sessionId: string): Promise<FusionSession> {
    const response = await fetch(`${this.apiUrl}/session/${sessionId}`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to get session: ${response.status}`);
    }

    return response.json() as Promise<FusionSession>;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/session/${sessionId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete session: ${response.status}`);
    }
  }

  async sendPrompt(sessionId: string, prompt: string): Promise<unknown> {
    const response = await fetch(`${this.apiUrl}/session/${sessionId}/prompt`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ prompt }),
    });

    if (!response.ok) {
      const error = await response.json() as { error?: { message?: string } };
      throw new Error(`Failed to send prompt: ${error?.error?.message || response.status}`);
    }

    return response.json();
  }

  async getMessages(sessionId: string): Promise<unknown[]> {
    const response = await fetch(`${this.apiUrl}/session/${sessionId}/messages`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to get messages: ${response.status}`);
    }

    const data = await response.json() as { messages?: unknown[] };
    return data.messages || [];
  }

  connectToSession(sessionId: string, onEvent: (event: unknown) => void): () => void {
    this.eventHandlers.add(onEvent);

    if (!this.ws) {
      const wsUrl = this.apiUrl.replace(/^http/, 'ws') + `/session/${sessionId}/ws`;
      
      if (typeof WebSocket !== 'undefined') {
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            for (const handler of this.eventHandlers) {
              handler(data);
            }
          } catch {
          }
        };

        this.ws.onerror = () => {
        };

        this.ws.onclose = () => {
          this.ws = null;
        };
      }
    }

    return () => {
      this.eventHandlers.delete(onEvent);
      if (this.eventHandlers.size === 0 && this.ws) {
        this.ws.close();
        this.ws = null;
      }
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.eventHandlers.clear();
  }

  async waitForSessionReady(sessionId: string, timeoutMs = 300000): Promise<FusionSession> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const session = await this.getSession(sessionId);
      
      if (session.status === 'active') {
        return session;
      }
      
      if (session.status === 'error') {
        throw new Error(`Session failed: ${session.error || 'Unknown error'}`);
      }
      
      if (session.status === 'stopped') {
        throw new Error('Session was stopped');
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    throw new Error('Timeout waiting for session to be ready');
  }
}
