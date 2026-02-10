
const BaseDriver = require('../core/driver_interface');
const nodemailer = require('nodemailer');
const imap = require('imap-simple');
const { simpleParser } = require('mailparser');

class GmailDriver extends BaseDriver {
    constructor(account) {
        super(account);
        this.transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: this.account.email,
                pass: this.account.password
            }
        });
    }

    async sendEmail(to, subject, html) {
        try {
            const info = await this.transporter.sendMail({
                from: this.account.email,
                to: to,
                subject: subject,
                html: html
            });
            console.log(`[Gmail] Sent to ${to}: ${info.messageId}`);
            return true;
        } catch (error) {
            console.error(`[Gmail] Send Error (${this.account.email}):`, error.message);
            throw error; // Let the main loop handle the error (and trigger cooldown)
        }
    }

    async rescueSpam(knownSenders) {
        let connection;
        let rescuedCount = 0;

        try {
            const config = {
                imap: {
                    user: this.account.email,
                    password: this.account.password,
                    host: 'imap.gmail.com',
                    port: 993,
                    tls: true,
                    authTimeout: 10000
                }
            };

            connection = await imap.connect(config);
            await connection.openBox('[Gmail]/Spam');

            // Search for ALL messages in Spam (since filtering by sender in IMAP search is tricky with multiple senders)
            // Optimization: We could search by date to limit volume.
            const searchCriteria = ['ALL'];
            const fetchOptions = { bodies: ['HEADER'], struct: true };

            const messages = await connection.search(searchCriteria, fetchOptions);

            for (const item of messages) {
                const headerPart = item.parts.find(part => part.which === 'HEADER');
                const headers = item.parts.find(part => part.which === 'HEADER').body;

                // Parse "From" header roughly
                const fromHeader = headers.from ? headers.from[0] : '';

                // Check if sender is in our "Friend List" (knownSenders is a Set or Array of emails)
                const isFriend = knownSenders.some(friendEmail => fromHeader.includes(friendEmail));

                if (isFriend) {
                    console.log(`[Gmail] Rescuing email from ${fromHeader}...`);

                    // Move to Inbox
                    await connection.moveMessage(item.attributes.uid, 'INBOX');

                    // Mark as Important (Star) - Gmail uses \Flagged for Star
                    // Note: Gmail specific labels might require X-GM-LABELS if we want to be fancy, but \Flagged is standard.
                    await connection.addFlags(item.attributes.uid, ['\\Flagged']); // Star it

                    rescuedCount++;
                }
            }

        } catch (error) {
            console.error(`[Gmail] Rescue Error (${this.account.email}):`, error.message);
        } finally {
            if (connection) {
                connection.end();
            }
        }
        return rescuedCount;
    }

    async healthCheck() {
        try {
            await this.transporter.verify();
            return { status: 'ok' };
        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }
}

module.exports = GmailDriver;
