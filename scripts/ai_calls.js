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
export async function callDeepSeek(prompt, modelName = 'deepseek-chat') {
    if (!process.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is not defined");

    const response = await axios({
        method: 'post',
        url: 'https://api.deepseek.com/v1/chat/completions',
        headers: {
            'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
        },
        data: {
            model: 'deepseek-v4-flash',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
        }
    });

    const message = response.data.choices[0].message.content;
    const usage = response.data.usage;

    // Normalize Deepseek token outputs to match Gemini interface style seamlessly
    return {
        text: message,
        usage: {
            promptTokenCount: usage.prompt_tokens,
            candidatesTokenCount: usage.completion_tokens,
            totalTokenCount: usage.total_tokens
        }
    };
}
