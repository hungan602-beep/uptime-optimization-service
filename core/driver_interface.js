
/**
 * Driver Interface (Abstract)
 * All drivers (Gmail, Microsoft, Generic) must implement these methods.
 * 
 * @typedef {Object} EmailDriver
 * @property {function(string, string, string): Promise<boolean>} sendEmail - (to, subject, html)
 * @property {function(string): Promise<number>} rescueSpam - (targetFolder) -> count of rescued emails
 * @property {function(string, string): Promise<void>} replyToEmail - (msgId, content)
 * @property {function(): Promise<Object>} healthCheck - Returns { status: 'ok' | 'error', latency: ms }
 * @property {function(): Promise<void>} close - Cleanup connection
 */

class BaseDriver {
    constructor(account) {
        this.account = account;
    }

    async sendEmail(to, subject, html) { throw new Error("Method 'sendEmail' must be implemented."); }
    async rescueSpam(knownSenders) { throw new Error("Method 'rescueSpam' must be implemented."); }
    async replyToEmail(msgId, content) { throw new Error("Method 'replyToEmail' must be implemented."); }
    async healthCheck() { throw new Error("Method 'healthCheck' must be implemented."); }
    async close() { }
}

module.exports = BaseDriver;
