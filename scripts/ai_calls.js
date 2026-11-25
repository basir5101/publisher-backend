import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Call Gemini AI natively bypassing direct Playwright SDK instantiation.
 * @param {string} prompt - The raw string prompt.
 * @param {string} modelName - Optional Gemini model name
 * @param {string} responseType - Expected response format (e.g. 'application/json')
 * @returns {Promise<{text: string, usage: any}>}
 */
export async function callGemini(prompt, modelName = "gemini-3.5-flash", responseType = 'application/json') {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not defined");

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: responseType }
    });

    const result = await model.generateContent(prompt);

    return {
        text: result.response.text(),
        usage: result.response.usageMetadata
    };
}

/**
 * Call DeepSeek AI (drop-in alternative to Gemini)
 * @param {string} prompt - The raw string prompt.
 * @param {string} modelName - Deepseek model name (e.g., 'deepseek-chat')
 * @returns {Promise<{text: string, usage: any}>}
 */
export async function callDeepSeek(prompt, modelName = 'deepseek-chat', options = {}) {
    if (!process.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is not defined");

    const payload = {
        model: modelName || 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: options.max_tokens || 8192
    };

    if (options.response_format !== null) {
        payload.response_format = options.response_format || { type: 'json_object' };
    }
    if (options.temperature !== undefined) {
        payload.temperature = options.temperature;
    }

    try {
        const response = await axios({
            method: 'post',
            url: 'https://api.deepseek.com/v1/chat/completions',
            headers: {
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            data: payload,
            timeout: options.timeout || 240000
        });

        const choice = response.data.choices[0];
        const message = choice?.message?.content || '';
        const usage = response.data.usage;

        if (choice?.finish_reason === 'length') {
            console.warn(`⚠️ [callDeepSeek] Response was truncated because it reached max_tokens limit (${payload.max_tokens})!`);
        }

        // Normalize Deepseek token outputs to match Gemini interface style seamlessly
        return {
            text: message,
            finishReason: choice?.finish_reason,
            usage: {
                promptTokenCount: usage?.prompt_tokens,
                candidatesTokenCount: usage?.completion_tokens,
                totalTokenCount: usage?.total_tokens
            }
        };
    } catch (error) {
        const errMsg = error.response?.data?.error?.message || error.message;
        throw new Error(`DeepSeek API error: ${errMsg}`);
    }
}

/**
 * Call OpenRouter AI (OpenAI-compatible multi-model gateway)
 * @param {string} prompt - The raw string prompt.
 * @param {string} modelName - OpenRouter model name (e.g., 'deepseek/deepseek-v4.1-flash-1017')
 * @param {object} options - Generation options (max_tokens, response_format, temperature, timeout, providerRouting)
 * @returns {Promise<{text: string, finishReason: string, usage: any}>}
 */
export async function callOpenRouter(prompt, modelName = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4.1-flash-1017', options = {}) {
    if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not defined in .env");

    const payload = {
        model: modelName || process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4.1-flash-1017',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: options.max_tokens || 16384
    };

    // OpenRouter provider routing (DeepInfra only by default or customized)
    if (options.providerRouting !== undefined) {
        if (options.providerRouting !== null) {
            payload.provider = options.providerRouting;
        }
    } else {
        const order = process.env.OPENROUTER_PROVIDER_ORDER
            ? process.env.OPENROUTER_PROVIDER_ORDER.split(',').map(s => s.trim()).filter(Boolean)
            : ['DeepInfra'];
        const allowFallbacks = process.env.OPENROUTER_ALLOW_FALLBACKS === 'true';

        payload.provider = {
            order,
            allow_fallbacks: allowFallbacks
        };
    }

    // Configure reasoning effort: default to 'none' so reasoning does not exhaust tokens before JSON generation
    if (options.reasoning !== undefined) {
        if (options.reasoning !== null) {
            payload.reasoning = options.reasoning;
        }
    } else {
        const reasoningEffort = process.env.OPENROUTER_REASONING_EFFORT || 'none';
        payload.reasoning = { effort: reasoningEffort };
    }

    if (options.response_format !== null && options.response_format !== undefined) {
        payload.response_format = options.response_format;
    } else if (options.response_format !== null) {
        payload.response_format = { type: 'json_object' };
    }

    if (options.temperature !== undefined) {
        payload.temperature = options.temperature;
    }

    const headers = {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://datainsightsreports.com',
        'X-Title': process.env.OPENROUTER_SITE_NAME || 'DataInsights Reports'
    };

    try {
        const response = await axios({
            method: 'post',
            url: 'https://openrouter.ai/api/v1/chat/completions',
            headers,
            data: payload,
            timeout: options.timeout || 240000
        });

        const choice = response.data?.choices?.[0];
        const message = choice?.message?.content || '';
        const usage = response.data?.usage;

        if (choice?.finish_reason === 'length') {
            if (!message) {
                console.warn(`⚠️ [callOpenRouter] All ${payload.max_tokens} tokens were consumed by reasoning before output content could be generated! Set reasoning: { effort: 'none' } or increase max_tokens.`);
            } else {
                console.warn(`⚠️ [callOpenRouter] Response was truncated because it reached max_tokens limit (${payload.max_tokens})!`);
            }
        }

        return {
            text: message,
            finishReason: choice?.finish_reason,
            usage: {
                promptTokenCount: usage?.prompt_tokens,
                candidatesTokenCount: usage?.completion_tokens,
                totalTokenCount: usage?.total_tokens
            }
        };
    } catch (error) {
        const errMsg = error.response?.data?.error?.message || error.message;
        throw new Error(`OpenRouter API error: ${errMsg}`);
    }
}

/**
 * Universal AI caller router (deepseek | openrouter | gemini)
 * @param {string} prompt - The raw string prompt.
 * @param {object} options - Options including provider, model, response_format, max_tokens, etc.
 * @returns {Promise<{text: string, finishReason: string, usage: any}>}
 */
export async function callAI(prompt, options = {}) {
    const provider = (options.provider || process.env.AI_PROVIDER || 'deepseek').toLowerCase();

    if (provider === 'openrouter') {
        const model = options.model || process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4.1-flash-1017';
        return callOpenRouter(prompt, model, options);
    }

    if (provider === 'gemini') {
        const model = options.model || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
        const responseType = options.response_format === null ? undefined : 'application/json';
        return callGemini(prompt, model, responseType);
    }

    // Default to deepseek
    const model = options.model || process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    return callDeepSeek(prompt, model, options);
}
