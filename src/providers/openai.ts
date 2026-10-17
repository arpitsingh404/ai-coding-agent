import {
    ChatMessage, Provider, ProviderError, StreamOptions, StreamResult, ToolCall,
    ToolSpec, parseArgs, sleep, sseLines
} from './types';

interface DeltaToolCall {
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
}

/**
 * Works with OpenAI, Gemini's OpenAI-compatible endpoint, Ollama,
 * LM Studio, OpenRouter or any OpenAI-style /chat/completions server.
 */
export class OpenAICompatibleProvider implements Provider {
    readonly id = 'openai-compatible';

    constructor(
        private readonly baseUrl: string,
        private readonly apiKey: string | undefined,
        private readonly extraHeaders: Record<string, string> = {}
    ) {}

    private toWire(messages: ChatMessage[]) {
        return messages.map((m) => {
            if (m.role === 'tool') {
                return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
            }
            if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length) {
                return {
                    role: 'assistant',
                    content: m.content || null,
                    tool_calls: m.toolCalls.map((t) => ({
                        id: t.id,
                        type: 'function',
                        function: { name: t.name, arguments: JSON.stringify(t.args ?? {}) }
                    }))
                };
            }
            return { role: m.role, content: m.content };
        });
    }

    async stream(messages: ChatMessage[], tools: ToolSpec[], opts: StreamOptions): Promise<StreamResult> {
        const body: Record<string, unknown> = {
            model: opts.model,
            messages: this.toWire(messages),
            temperature: opts.temperature,
            max_tokens: opts.maxTokens,
            stream: true
        };
        if (tools.length) {
            body.tools = tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.parameters }
            }));
            body.tool_choice = 'auto';
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...this.extraHeaders
        };
        if (this.apiKey) { headers.Authorization = `Bearer ${this.apiKey}`; }

        let res = await this.post(headers, body, opts.signal);
        let attempt = 0;
        while (!res.ok && (res.status === 429 || res.status >= 500) && attempt < 2) {
            const wait = 1200 * Math.pow(2, attempt);
            attempt++;
            await sleep(wait);
            res = await this.post(headers, body, opts.signal);
        }

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new ProviderError(
                `Provider error ${res.status}: ${truncate(text, 600)}`,
                res.status,
                res.status === 429 || res.status >= 500
            );
        }

        let text = '';
        const calls = new Map<number, DeltaToolCall>();

        for await (const line of sseLines(res)) {
            if (!line.startsWith('data:')) { continue; }
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') { continue; }
            let json: any;
            try { json = JSON.parse(payload); } catch { continue; }

            const choice = json.choices?.[0];
            const delta = choice?.delta ?? {};

            if (typeof delta.content === 'string' && delta.content.length) {
                text += delta.content;
                opts.onText?.(delta.content);
            }

            const tcs: DeltaToolCall[] | undefined = delta.tool_calls;
            if (Array.isArray(tcs)) {
                for (const tc of tcs) {
                    const idx = typeof tc.index === 'number' ? tc.index : 0;
                    const cur = calls.get(idx) ?? { index: idx };
                    if (tc.id) { cur.id = tc.id; }
                    if (tc.function?.name) { cur.function = { ...(cur.function ?? {}), name: tc.function.name }; }
                    if (tc.function?.arguments) {
                        cur.function = cur.function ?? {};
                        cur.function.arguments = (cur.function.arguments ?? '') + tc.function.arguments;
                    }
                    calls.set(idx, cur);
                }
            }
        }

        const toolCalls: ToolCall[] = [...calls.values()]
            .sort((a, b) => a.index - b.index)
            .filter((c) => !!c.function?.name)
            .map((c, i) => ({
                id: c.id || `call_${Date.now()}_${i}`,
                name: c.function!.name!,
                args: parseArgs(c.function!.arguments ?? '{}')
            }));

        return { text, toolCalls };
    }

    private post(headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<Response> {
        return fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal
        });
    }
}

function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) + '…' : s;
}
