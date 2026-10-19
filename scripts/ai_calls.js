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
}
