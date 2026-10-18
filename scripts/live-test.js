/**
 * Live integration test against a real provider (DeepSeek).
 * Usage:  set DEEPSEEK_API_KEY=sk-...   then   node scripts/live-test.js
 */
const { OpenAICompatibleProvider } = require('../out/providers/openai');

const key = process.env.DEEPSEEK_API_KEY;
if (!key) {
    console.error('DEEPSEEK_API_KEY not set');
    process.exit(1);
}

const BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro';
const provider = new OpenAICompatibleProvider(BASE, key);

const TOOLS = [
    {
        name: 'read_file',
        description: 'Read a file from the workspace.',
        parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path']
        }
    }
];

async function testPlainText() {
    let streamed = '';
    const res = await provider.stream(
        [{ role: 'user', content: 'Reply with exactly one word: PONG' }],
        [],
        { model: MODEL, temperature: 0, maxTokens: 32, onText: (d) => { streamed += d; } }
    );
    console.log('--- plain text ---');
    console.log('text     :', JSON.stringify((res.text || '').trim()));
    console.log('streamed :', JSON.stringify(streamed.trim()));
    if (!(res.text || '').toUpperCase().includes('PONG')) {
        throw new Error('plain text response missing PONG');
    }
    if (!streamed.length) { throw new Error('no streamed deltas received'); }
    console.log('PASS: text + streaming\n');
}

async function testToolCall() {
    const res = await provider.stream(
        [
            { role: 'system', content: 'You are a tool-calling agent. Use tools when asked.' },
            { role: 'user', content: 'Call the read_file tool with path "package.json". Do not answer in text.' }
        ],
        TOOLS,
        { model: MODEL, temperature: 0, maxTokens: 128 }
    );
    console.log('--- tool calling ---');
    console.log('text      :', JSON.stringify((res.text || '').trim()));
    console.log('toolCalls :', JSON.stringify(res.toolCalls));
    if (!res.toolCalls.length) {
        throw new Error('provider returned no tool calls');
    }
    const call = res.toolCalls[0];
    if (call.name !== 'read_file') { throw new Error('unexpected tool: ' + call.name); }
    if (call.args.path !== 'package.json') { throw new Error('bad args: ' + JSON.stringify(call.args)); }
    console.log('PASS: tool call parsed with args\n');
    return call;
}

async function testToolRoundTrip(call) {
    // Feed the tool result back and expect a final text answer
    const res = await provider.stream(
        [
            { role: 'user', content: 'Call the read_file tool with path "package.json".' },
            { role: 'assistant', content: '', toolCalls: [call] },
            { role: 'tool', toolCallId: call.id, toolName: 'read_file', content: '{"name":"ai-coding-agent"}' }
        ],
        TOOLS,
        { model: MODEL, temperature: 0, maxTokens: 128 }
    );
    console.log('--- tool round trip ---');
    console.log('final text:', JSON.stringify((res.text || '').trim().slice(0, 200)));
    if (!(res.text || '').trim().length) { throw new Error('no final text after tool result'); }
    console.log('PASS: tool result accepted\n');
}

(async () => {
    console.log('provider:', BASE, '| model:', MODEL, '\n');
    await testPlainText();
    const call = await testToolCall();
    await testToolRoundTrip(call);
    console.log('ALL LIVE TESTS PASSED');
})().catch((e) => {
    console.error('\nLIVE TEST FAILED:', e.message);
    process.exit(1);
});
