export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
    id: string;
    name: string;
    /** Parsed JSON arguments. */
    args: Record<string, unknown>;
}

export interface ChatMessage {
    role: Role;
    content: string;
    /** assistant only */
    toolCalls?: ToolCall[];
    /** tool only */
    toolCallId?: string;
    toolName?: string;
}

export interface ToolSpec {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface StreamOptions {
    model: string;
    temperature: number;
    maxTokens: number;
    signal?: AbortSignal;
    /** Called for every streamed text delta. */
    onText?: (delta: string) => void;
}

export interface StreamResult {
    text: string;
    toolCalls: ToolCall[];
    usage?: { input?: number; output?: number };
}

export interface Provider {
    readonly id: string;
    stream(
        messages: ChatMessage[],
        tools: ToolSpec[],
        opts: StreamOptions
    ): Promise<StreamResult>;
}

export class ProviderError extends Error {
    constructor(message: string, readonly status?: number, readonly retryable = false) {
        super(message);
        this.name = 'ProviderError';
    }
}

export function parseArgs(raw: string): Record<string, unknown> {
    if (!raw || !raw.trim()) { return {}; }
    try {
        const v = JSON.parse(raw);
        return v && typeof v === 'object' ? (v as Record<string, unknown>) : { value: v };
    } catch {
        return { __raw: raw };
    }
}

export async function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/** Read an SSE response body line by line. */
export async function* sseLines(res: Response): AsyncGenerator<string> {
    const reader = res.body?.getReader();
    if (!reader) { return; }
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { value, done } = await reader.read();
        if (done) { break; }
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, idx).replace(/\r$/, '');
            buffer = buffer.slice(idx + 1);
            if (line) { yield line; }
        }
    }
    if (buffer.trim()) { yield buffer.trim(); }
}
