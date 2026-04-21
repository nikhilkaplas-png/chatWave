const Anthropic = require('@anthropic-ai/sdk');

class ClaudeCompanion {
    /**
     * @param {{ apiKey?: string, model?: string, systemPrompt?: string }} [options]
     */
    constructor(options = {}) {
        this.apiKey = (options.apiKey || '').trim();
        this.model = options.model || 'claude-haiku-4-5';
        this.systemPrompt =
            options.systemPrompt ||
            'You are ChatWave AI, a concise friendly assistant in a group chat. ' +
                'Use plain text. Do not pretend to be human users. Keep replies reasonably short unless asked for detail.';
    }

    isConfigured() {
        return Boolean(this.apiKey && String(this.apiKey).trim());
    }

    /**
     * @param {{ username: string, text: string }[]} roomHistory
     * @param {string} userPrompt
     * @returns {{ system: string, messages: { role: 'user', content: string }[] }}
     */
    buildMessages(roomHistory, userPrompt) {
        const transcript = roomHistory
            .map((m) => `${m.username}: ${m.text}`)
            .join('\n')
            .slice(0, 100000);
        const q = String(userPrompt).slice(0, 8000);
        const userContent = transcript.length
            ? `Recent chat in this room (oldest first):\n${transcript}\n\nQuestion from a participant:\n${q}`
            : q;
        return {
            system: this.systemPrompt,
            messages: [{ role: 'user', content: userContent }],
        };
    }

    _client() {
        return new Anthropic({ apiKey: this.apiKey });
    }

    /**
     * @param {{ system: string, messages: { role: 'user', content: string }[] }} payload
     * @returns {Promise<string>}
     */
    async complete(payload) {
        const client = this._client();
        const res = await client.messages.create({
            model: this.model,
            max_tokens: 1024,
            system: payload.system,
            messages: payload.messages,
        });
        const blocks = res.content.filter((b) => b.type === 'text');
        return blocks.map((b) => b.text).join('').trim();
    }

    /**
     * @param {{ system: string, messages: { role: 'user', content: string }[] }} payload
     * @param {(chunk: string) => void} onChunk
     * @returns {Promise<string>}
     */
    async streamCompletion(payload, onChunk) {
        const client = this._client();
        const stream = client.messages.stream({
            model: this.model,
            max_tokens: 1024,
            system: payload.system,
            messages: payload.messages,
        });
        let full = '';
        for await (const event of stream) {
            if (
                event.type === 'content_block_delta' &&
                event.delta?.type === 'text_delta' &&
                event.delta.text
            ) {
                full += event.delta.text;
                onChunk(event.delta.text);
            }
        }
        return full.trim();
    }
}

module.exports = { ClaudeCompanion };
