import {
    ChatMessage, Provider, ProviderError, StreamOptions, StreamResult, ToolCall,
    ToolSpec, parseArgs, sleep, sseLines
} from './types';

interface BlockState {
    type: 'text' | 'tool_use';
    id?: string;
    name?: string;
    json: string;
}

/**
 * Native Anthropic Messages API with streaming + tool use.
 */
export class AnthropicProvider implements Provider {
    readonly id = 'anthropic';

    constructor(private readonly apiKey: string, private readonly baseUrl = 'https://api.anthropic.com') {}

    private toWire(messages: ChatMessage[]) {
        const out: any[] = [];
        for (const m of messages) {
            if (m.role === 'system') { continue; }
            if (m.role === 'tool') {
                out.push({
                    role: 'user',
                    content: [{
                        type: 'tool_result',
                        tool_use_id: m.toolCallId,
                        content: m.content || '(no output)'
                    }]
                });
                continue;
            }
            if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length) {
                const blocks: any[] = [];
                if (m.content) { blocks.push({ type: 'text', text: m.content }); }
                for (const t of m.toolCalls) {
                    blocks.push({ type: 'tool_use', id: t.id, name: t.name, input: t.args ?? {} });
                }
                out.push({ role: 'assistant', content: blocks });
                continue;
            }
            out.push({ role: m.role, content: m.content });
        }
        return out;
    }

    async stream(messages: ChatMessage[], tools: ToolSpec[], opts: StreamOptions): Promise<StreamResult> {
        const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
        const body: Record<string, unknown> = {
            model: opts.model,
            max_tokens: opts.maxTokens,
            temperature: opts.temperature,
            stream: true,
            messages: this.toWire(messages)
        };
        if (system) { body.system = system; }
        if (tools.length) {
            body.tools = tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters
            }));
        }

        const headers = {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01'
        };

        let res = await this.post(headers, body, opts.signal);
        let attempt = 0;
        while (!res.ok && (res.status === 429 || res.status >= 500) && attempt < 2) {
            attempt++;
            await sleep(1200 * Math.pow(2, attempt));
            res = await this.post(headers, body, opts.signal);
        }
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new ProviderError(`Anthropic error ${res.status}: ${text.slice(0, 600)}`, res.status, res.status === 429 || res.status >= 500);
        }

        let text = '';
        const blocks = new Map<number, BlockState>();
        const usage: { input?: number; output?: number } = {};

        for await (const line of sseLines(res)) {
            if (!line.startsWith('data:')) { continue; }
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') { continue; }
            let ev: any;
            try { ev = JSON.parse(payload); } catch { continue; }

            if (ev.type === 'message_start' && ev.message?.usage) {
                usage.input = ev.message.usage.input_tokens;
            }
            if (ev.type === 'message_delta' && ev.usage) {
                usage.output = ev.usage.output_tokens;
            }

            switch (ev.type) {
                case 'content_block_start': {
                    const idx = ev.index ?? 0;
                    const cb = ev.content_block ?? {};
                    if (cb.type === 'tool_use') {
                        blocks.set(idx, { type: 'tool_use', id: cb.id, name: cb.name, json: '' });
                    } else {
                        blocks.set(idx, { type: 'text', json: '' });
                    }
                    break;
                }
                case 'content_block_delta': {
                    const idx = ev.index ?? 0;
                    const d = ev.delta ?? {};
                    if (d.type === 'text_delta' && typeof d.text === 'string') {
                        text += d.text;
                        opts.onText?.(d.text);
                    } else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string') {
                        const b = blocks.get(idx);
                        if (b) { b.json += d.partial_json; }
                    }
                    break;
                }
                default:
                    break;
            }
        }

        const toolCalls: ToolCall[] = [...blocks.entries()]
            .filter(([, b]) => b.type === 'tool_use' && !!b.name)
            .map(([idx, b], i) => ({
                id: b.id || `toolu_${Date.now()}_${i}`,
                name: b.name!,
                args: parseArgs(b.json || '{}')
            }));

        return { text, toolCalls, usage: usage.input || usage.output ? usage : undefined };
    }

    private post(headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<Response> {
        return fetch(`${this.baseUrl}/v1/messages`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal
        });
    }
}
