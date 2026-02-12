const BaseDriver = require('../core/driver_interface');
const axios = require('axios');
const qs = require('qs');
const { SocksProxyAgent } = require('socks-proxy-agent');
const proxyConfig = require('../config/proxy');

class MicrosoftDriver extends BaseDriver {
    constructor(account) {
        super(account);
        this.email = account.username || account.email;
        this.refreshToken = account._token;
        this.clientId = account.client_id;
        this.accessToken = null;

        // Build proxy agent if enabled
        this.agent = null;
        if (proxyConfig.enabled) {
            const proxyUrl = `socks5://${proxyConfig.userId}:${proxyConfig.password}@${proxyConfig.host}:${proxyConfig.port}`;
            this.agent = new SocksProxyAgent(proxyUrl);
            console.log(`[MS-Graph] Proxy: ${proxyConfig.host}`);
        }
    }

    async refreshAccessToken() {
        const tokenUrl = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
        const body = qs.stringify({
            client_id: this.clientId,
            refresh_token: this.refreshToken,
            grant_type: 'refresh_token',
            scope: 'https://graph.microsoft.com/.default offline_access'
        });

        const config = {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        };
        if (this.agent) {
            config.httpsAgent = this.agent;
            config.httpAgent = this.agent;
        }

        const response = await axios.post(tokenUrl, body, config);
        this.accessToken = response.data.access_token;
        return this.accessToken;
    }

    async sendEmail(to, subject, bodyContent) {
        // Step 1: Get fresh access token
        await this.refreshAccessToken();

        // Step 2: Send via Graph API
        const graphUrl = 'https://graph.microsoft.com/v1.0/me/sendMail';
        const payload = {
            message: {
                subject: subject,
                body: {
                    contentType: 'HTML',
                    content: bodyContent
                },
                toRecipients: [
                    { emailAddress: { address: to } }
                ]
            }
        };

        const config = {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            }
        };
        if (this.agent) {
            config.httpsAgent = this.agent;
            config.httpAgent = this.agent;
        }

        const response = await axios.post(graphUrl, payload, config);
        // HTTP 202 = success (empty body)
        console.log(`[MS-Graph] Sent to ${to} from ${this.email} (HTTP ${response.status})`);
        return true;
    }

    _graphConfig() {
        const cfg = {
            headers: { 'Authorization': `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
            timeout: 20000
        };
        if (this.agent) { cfg.httpsAgent = this.agent; cfg.httpAgent = this.agent; }
        return cfg;
    }

    async rescueSpam(knownSenders) {
        let rescuedCount = 0;
        try {
            await this.refreshAccessToken();
            const cfg = this._graphConfig();

            // Get junk email messages
            const junkResp = await axios.get(
                'https://graph.microsoft.com/v1.0/me/mailFolders/junkemail/messages?$top=100&$select=id,subject,from',
                cfg
            );
            const junkMsgs = junkResp.data.value || [];

            for (const msg of junkMsgs) {
                const fromAddr = msg.from && msg.from.emailAddress ? msg.from.emailAddress.address : '';
                const isFriend = knownSenders.some(f => fromAddr.includes(f) || (msg.subject || '').includes(f));

                if (isFriend) {
                    try {
                        await axios.post(
                            `https://graph.microsoft.com/v1.0/me/messages/${msg.id}/move`,
                            { destinationId: 'inbox' },
                            cfg
                        );
                        rescuedCount++;
                        console.log(`[MS-Graph] 🛟 Rescued: ${fromAddr}`);
                    } catch (e) { }
                }
            }
        } catch (error) {
            // Suppress — permissions may not allow junk access
        }
        return rescuedCount;
    }

    async engageInbox(knownSenders) {
        const result = { read: 0, starred: 0, replied: 0 };
        const ContentGenerator = require('../content/generator');
        const REPLY_CHANCE = 0.7;

        try {
            await this.refreshAccessToken();
            const cfg = this._graphConfig();

            // Get recent 50 inbox messages
            const inboxResp = await axios.get(
                'https://graph.microsoft.com/v1.0/me/messages?$top=50&$select=id,subject,from,isRead,flag,conversationId',
                cfg
            );
            const messages = inboxResp.data.value || [];

            for (const msg of messages) {
                const fromAddr = msg.from && msg.from.emailAddress ? msg.from.emailAddress.address : '';
                const isFriend = knownSenders.some(f => fromAddr.includes(f) || (msg.subject || '').includes(f));
                if (!isFriend) continue;

                // Mark as Read
                if (!msg.isRead) {
                    try {
                        await axios.patch(
                            `https://graph.microsoft.com/v1.0/me/messages/${msg.id}`,
                            { isRead: true },
                            cfg
                        );
                        result.read++;
                    } catch (e) { }
                }

                // Flag (Star equivalent)
                const flagStatus = msg.flag && msg.flag.flagStatus;
                if (flagStatus !== 'flagged') {
                    try {
                        await axios.patch(
                            `https://graph.microsoft.com/v1.0/me/messages/${msg.id}`,
                            { flag: { flagStatus: 'flagged' } },
                            cfg
                        );
                        result.starred++;
                    } catch (e) { }
                }

                // Reply (30% chance)
                if (Math.random() < REPLY_CHANCE) {
                    try {
                        const replyBody = ContentGenerator.generateReply(msg.subject);
                        await axios.post(
                            `https://graph.microsoft.com/v1.0/me/messages/${msg.id}/reply`,
                            { comment: replyBody },
                            cfg
                        );
                        result.replied++;
                        console.log(`[MS-Graph] 💬 Replied to ${fromAddr.substring(0, 20)}...`);
                    } catch (e) { }
                }
            }
        } catch (error) {
            console.error(`[MS-Graph] Engage Error (${this.email}):`, error.message);
        }
        return result;
    }

    async healthCheck() {
        try {
            await this.refreshAccessToken();
            return { status: 'ok' };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }
}

module.exports = MicrosoftDriver;
