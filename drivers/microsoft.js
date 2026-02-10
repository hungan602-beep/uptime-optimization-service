
const BaseDriver = require('../core/driver_interface');
const axios = require('axios');
const qs = require('qs');

class MicrosoftDriver extends BaseDriver {
    constructor(account) {
        super(account);
        this.accessToken = null;
        this.tokenExpiry = 0;
    }

    async getAccessToken() {
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }

        try {
            const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
            const FALLBACK_CLIENT_ID = '9e5f94bc-e8a4-4e73-b8be-63364c29d753';
            const data = {
                client_id: this.account.clientId || FALLBACK_CLIENT_ID,
                refresh_token: this.account.refreshToken || this.account._token,
                grant_type: 'refresh_token',
                scope: 'Mail.ReadWrite Mail.Send User.Read'
            };

            if (this.account.clientSecret) {
                data.client_secret = this.account.clientSecret;
            }

            const response = await axios.post(tokenUrl, qs.stringify(data), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            this.accessToken = response.data.access_token;
            // Set expiry a bit earlier than actual (e.g., 5 mins buffer)
            this.tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 300000;
            return this.accessToken;

        } catch (error) {
            console.error(`[Microsoft] Auth Error (${this.account.email}):`, error.response ? error.response.data : error.message);
            throw new Error('Microsoft Auth Failed');
        }
    }

    async sendEmail(to, subject, html) {
        try {
            const token = await this.getAccessToken();
            const message = {
                message: {
                    subject: subject,
                    body: {
                        contentType: 'HTML',
                        content: html
                    },
                    toRecipients: [
                        {
                            emailAddress: {
                                address: to
                            }
                        }
                    ]
                },
                saveToSentItems: 'true'
            };

            await axios.post('https://graph.microsoft.com/v1.0/me/sendMail', message, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            console.log(`[Microsoft] Sent to ${to}`);
            return true;
        } catch (error) {
            console.error(`[Microsoft] Send Error (${this.account.email}):`, error.response ? error.response.data : error.message);
            throw error;
        }
    }

    async rescueSpam(knownSenders) {
        let rescuedCount = 0;
        try {
            const token = await this.getAccessToken();

            // 1. Get Junk Folder ID (or just use 'junkemail' well-known name)
            // 2. List messages in Junk
            const url = 'https://graph.microsoft.com/v1.0/me/mailFolders/junkemail/messages?$select=id,sender,subject&$top=50';

            const response = await axios.get(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const messages = response.data.value || [];

            for (const msg of messages) {
                const senderEmail = msg.sender.emailAddress.address;

                // Check against friend list
                const isFriend = knownSenders.some(friend => senderEmail.toLowerCase().includes(friend.toLowerCase()));

                if (isFriend) {
                    console.log(`[Microsoft] Rescuing email from ${senderEmail}...`);

                    // Move to Inbox
                    await axios.post(`https://graph.microsoft.com/v1.0/me/messages/${msg.id}/move`, {
                        destinationId: 'inbox'
                    }, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });

                    // Mark as Read (optional, better to leave unread for reply logic? No, rescue usually implies "I saw this")
                    // Actually, "Mark as Important" in Outlook isn't a direct flag like Gmail star, 
                    // but we can set 'importance': 'high' via PATCH, or just rely on the move + reply.
                    // Let's PATCH it to have importance = high
                    await axios.patch(`https://graph.microsoft.com/v1.0/me/messages/${msg.id}`, {
                        importance: 'high'
                    }, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });

                    rescuedCount++;
                }
            }

        } catch (error) {
            console.error(`[Microsoft] Rescue Error (${this.account.email}):`, error.response ? error.response.data : error.message);
        }
        return rescuedCount;
    }

    async replyToEmail(msgId, content) {
        try {
            const token = await this.getAccessToken();

            // Microsoft Graph Reply Endpoint
            // POST /me/messages/{id}/reply
            await axios.post(`https://graph.microsoft.com/v1.0/me/messages/${msgId}/reply`, {
                comment: content
            }, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            console.log(`[Microsoft] Replied to message ${msgId}`);

        } catch (error) {
            console.error(`[Microsoft] Reply Error (${this.account.email}):`, error.response ? error.response.data : error.message);
        }
    }

    async healthCheck() {
        try {
            await this.getAccessToken();
            return { status: 'ok' };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }
}

module.exports = MicrosoftDriver;
