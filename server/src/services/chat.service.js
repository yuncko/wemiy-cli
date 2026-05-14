import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";

export class ChatService {
    constructor() {
        this.configDir = path.join(os.homedir(), ".orbital-cli");
        this.storeFile = path.join(this.configDir, "chats.json");
        this.store = null;
    }

    async _initStore() {
        if (this.store) return;
        try {
            await fs.mkdir(this.configDir, { recursive: true });
            const data = await fs.readFile(this.storeFile, "utf-8");
            this.store = JSON.parse(data);
        } catch (error) {
            this.store = { conversations: [], messages: [] };
            await this._saveStore();
        }
    }

    async _saveStore() {
        await fs.writeFile(this.storeFile, JSON.stringify(this.store, null, 2), "utf-8");
    }

    async createConversation(userId, mode = "chat", title = null) {
        await this._initStore();
        const conv = {
            id: crypto.randomUUID(),
            userId,
            mode,
            title: title || `New ${mode} conversation`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.store.conversations.push(conv);
        await this._saveStore();
        return { ...conv, messages: [] };
    }

    async getOrCreateConversation(userId, conversationId = null, mode = "chat") {
        await this._initStore();
        if (conversationId) {
            const conversation = this.store.conversations.find((c) => c.id === conversationId && c.userId === userId);
            if (conversation) {
                const messages = this.store.messages
                    .filter((m) => m.conversationId === conversationId)
                    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
                return { ...conversation, messages };
            }
        }
        return await this.createConversation(userId, mode);
    }

    async addMessage(conversationId, role, content) {
        await this._initStore();
        const contentStr = typeof content === "string" ? content : JSON.stringify(content);
        const msg = {
            id: crypto.randomUUID(),
            conversationId,
            role,
            content: contentStr,
            createdAt: new Date().toISOString()
        };
        this.store.messages.push(msg);
        
        const conv = this.store.conversations.find(c => c.id === conversationId);
        if (conv) {
            conv.updatedAt = new Date().toISOString();
        }
        
        await this._saveStore();
        return msg;
    }

    async getMessages(conversationId) {
        await this._initStore();
        const msgs = this.store.messages
            .filter((m) => m.conversationId === conversationId)
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        return msgs.map((msg) => ({
            ...msg,
            content: this.parseContent(msg.content),
        }));
    }

    async getUserConversations(userId) {
        await this._initStore();
        return this.store.conversations
            .filter((c) => c.userId === userId)
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
            .map((c) => {
                const lastMsg = this.store.messages
                    .filter((m) => m.conversationId === c.id)
                    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
                return { ...c, messages: lastMsg ? [lastMsg] : [] };
            });
    }

    /** @returns {Promise<number>} */
    async countMessages(conversationId) {
        await this._initStore();
        return this.store.messages.filter((m) => m.conversationId === conversationId).length;
    }

    /**
     * @param {string} conversationId
     * @param {string} userId
     * @returns {Promise<object|null>}
     */
    async getConversation(conversationId, userId) {
        await this._initStore();
        const conversation = this.store.conversations.find(
            (c) => c.id === conversationId && c.userId === userId
        );
        if (!conversation) return null;
        const messages = await this.getMessages(conversationId);
        return { ...conversation, messages };
    }

    /**
     * Copy a conversation and its messages (optionally up to and including a message id).
     * @param {string} userId
     * @param {string} sourceConversationId
     * @param {string|null} [untilMessageId] - if set, copy messages up to and including this id (by timeline order)
     * @returns {Promise<object|null>} new conversation or null if source missing
     */
    async forkConversation(userId, sourceConversationId, untilMessageId = null) {
        await this._initStore();
        const source = this.store.conversations.find(
            (c) => c.id === sourceConversationId && c.userId === userId
        );
        if (!source) return null;

        const rawMsgs = this.store.messages
            .filter((m) => m.conversationId === sourceConversationId)
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        let toCopy = rawMsgs;
        if (untilMessageId) {
            const idx = toCopy.findIndex((m) => m.id === untilMessageId);
            if (idx >= 0) {
                toCopy = toCopy.slice(0, idx + 1);
            }
        }

        const title = `Fork: ${source.title}`.slice(0, 120);
        const newConv = await this.createConversation(userId, source.mode, title);

        for (const m of toCopy) {
            await this.addMessage(newConv.id, m.role, m.content);
        }

        return { ...newConv, messages: await this.getMessages(newConv.id) };
    }

    async deleteConversation(conversationId, userId) {
        await this._initStore();
        const initialLen = this.store.conversations.length;
        this.store.conversations = this.store.conversations.filter(c => !(c.id === conversationId && c.userId === userId));
        if (this.store.conversations.length < initialLen) {
            this.store.messages = this.store.messages.filter(m => m.conversationId !== conversationId);
            await this._saveStore();
            return { count: 1 };
        }
        return { count: 0 };
    }

    async updateTitle(conversationId, title) {
        await this._initStore();
        const conv = this.store.conversations.find(c => c.id === conversationId);
        if (conv) {
            conv.title = title;
            conv.updatedAt = new Date().toISOString();
            await this._saveStore();
            return conv;
        }
        return null;
    }

    parseContent(content) {
        try {
            return JSON.parse(content);
        } catch {
            return content;
        }
    }

    formatMessagesForAI(messages) {
        return messages.map((msg) => ({
            role: msg.role,
            content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        }));
    }
}