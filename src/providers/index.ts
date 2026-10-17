import { AgentConfig, DEFAULT_BASE_URLS, resolveBaseUrl, resolveModel } from '../config/settings';
import { AnthropicProvider } from './anthropic';
import { OpenAICompatibleProvider } from './openai';
import { Provider } from './types';

export * from './types';

export interface ProviderInfo {
    provider: string;
    model: string;
    baseUrl: string;
    hasKey: boolean;
}

export function createProvider(cfg: AgentConfig, apiKey: string | undefined): Provider {
    const baseUrl = resolveBaseUrl(cfg);

    if (cfg.provider === 'anthropic') {
        if (!apiKey) {
            throw new Error('Anthropic API key missing. Run "AI Coding Agent: Set API Key".');
        }
        return new AnthropicProvider(apiKey, baseUrl || DEFAULT_BASE_URLS.anthropic);
    }

    if (cfg.provider === 'ollama' && !baseUrl) {
        throw new Error('Ollama base URL missing (default http://localhost:11434/v1).');
    }
    if (cfg.provider !== 'ollama' && !apiKey && cfg.provider !== 'custom') {
        throw new Error(`API key missing for ${cfg.provider}. Run "AI Coding Agent: Set API Key".`);
    }
    if (!baseUrl) {
        throw new Error('Base URL missing. Set aiCodingAgent.baseUrl in settings.');
    }

    return new OpenAICompatibleProvider(baseUrl, apiKey);
}

export function providerInfo(cfg: AgentConfig, hasKey: boolean): ProviderInfo {
    return {
        provider: cfg.provider,
        model: resolveModel(cfg),
        baseUrl: resolveBaseUrl(cfg),
        hasKey
    };
}
