export interface OpenCodeSession {
  id: string;
  slug?: string;
  version?: string;
  projectID?: string;
  directory?: string;
  title?: string;
  time?: {
    created: number;
    updated: number;
  };
  summary?: {
    additions: number;
    deletions: number;
    files: number;
  };
}

export interface OpenCodeMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  parts: OpenCodeMessagePart[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type OpenCodeMessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool-invocation'; toolInvocationId: string; toolName: string; args: Record<string, unknown>; state: string; result?: unknown }
  | { type: 'file'; mimeType: string; url: string };

export interface OpenCodeEvent {
  type: string;
  sessionId?: string;
  [key: string]: unknown;
}

export interface OpenCodeHealthResponse {
  healthy: boolean;
  version?: string;
}

export interface OpenCodeSessionCreateResponse {
  id: string;
}

export interface OpenCodeMessageResponse {
  id: string;
  role: string;
  parts: OpenCodeMessagePart[];
  createdAt: string;
}
