import * as vscode from 'vscode';

export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'custom';

export interface AgentConfig {
    provider: ProviderName;
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
    maxIterations: number;
    requireApprovalForEdits: boolean;
    requireApprovalForCommands: boolean;
    autoApproveReads: boolean;
    commandPolicy: 'strict' | 'warn' | 'off';
    maxContextFiles: number;
    maxContextBytes: number;
    excludeGlobs: string[];
    secretFilePatterns: string[];
    commandTimeoutMs: number;
    allowNetworkTools: boolean;
}

const SECTION = 'aiCodingAgent';

export function readConfig(): AgentConfig {
    const c = vscode.workspace.getConfiguration(SECTION);
    return {
        provider: c.get<ProviderName>('provider', 'openai'),
        baseUrl: c.get<string>('baseUrl', ''),
        model: c.get<string>('model', ''),
        temperature: c.get<number>('temperature', 0.2),
        maxTokens: c.get<number>('maxTokens', 4096),
        maxIterations: c.get<number>('maxIterations', 25),
        requireApprovalForEdits: c.get<boolean>('requireApprovalForEdits', true),
        requireApprovalForCommands: c.get<boolean>('requireApprovalForCommands', true),
        autoApproveReads: c.get<boolean>('autoApproveReads', true),
        commandPolicy: c.get<'strict' | 'warn' | 'off'>('commandPolicy', 'strict'),
        maxContextFiles: c.get<number>('maxContextFiles', 40),
        maxContextBytes: c.get<number>('maxContextBytes', 200000),
        excludeGlobs: c.get<string[]>('excludeGlobs', []),
        secretFilePatterns: c.get<string[]>('secretFilePatterns', []),
        commandTimeoutMs: c.get<number>('commandTimeoutMs', 120000),
        allowNetworkTools: c.get<boolean>('allowNetworkTools', false)
    };
}

const SECRET_PREFIX = 'aiCodingAgent.apiKey.';

/** Environment-variable fallback so CI / power users can supply keys without the UI. */
const ENV_NAMES: Record<string, string[]> = {
    openai: ['OPENAI_API_KEY'],
    anthropic: ['ANTHROPIC_API_KEY'],
    gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    ollama: [],
    custom: ['CUSTOM_API_KEY', 'DEEPSEEK_API_KEY']
};

export async function getApiKey(ctx: vscode.ExtensionContext, provider: string): Promise<string | undefined> {
    const stored = await ctx.secrets.get(SECRET_PREFIX + provider);
    if (stored && stored.trim()) { return stored.trim(); }
    for (const name of ENV_NAMES[provider] ?? []) {
        const v = process.env[name];
        if (v && v.trim()) { return v.trim(); }
    }
    return undefined;
}

export async function setApiKey(ctx: vscode.ExtensionContext, provider: string, key: string): Promise<void> {
    await ctx.secrets.store(SECRET_PREFIX + provider, key);
}

export async function deleteApiKey(ctx: vscode.ExtensionContext, provider: string): Promise<void> {
    await ctx.secrets.delete(SECRET_PREFIX + provider);
}

export const DEFAULT_MODELS: Record<ProviderName, string> = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-sonnet-4-5',
    gemini: 'gemini-2.5-flash',
    ollama: 'qwen2.5-coder:7b',
    custom: 'gpt-4o-mini'
};

export const DEFAULT_BASE_URLS: Record<ProviderName, string> = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
    ollama: 'http://localhost:11434/v1',
    custom: ''
};

export function resolveModel(cfg: AgentConfig): string {
    return cfg.model?.trim() || DEFAULT_MODELS[cfg.provider];
}

export function resolveBaseUrl(cfg: AgentConfig): string {
    const raw = cfg.baseUrl?.trim() || DEFAULT_BASE_URLS[cfg.provider];
    return raw.replace(/\/+$/, '');
}
