
const BaseDriver = require('../core/driver_interface');
const nodemailer = require('nodemailer');
const imap = require('imap-simple');
const { simpleParser } = require('mailparser');

class GenericDriver extends BaseDriver {
    constructor(account) {
        super(account);
        const smtp = this.account.smtp || {};
        this.transporter = nodemailer.createTransport({
            host: this.account.smtpHost || smtp.host,
            port: this.account.smtpPort || smtp.port || 465,
            secure: (this.account.smtpPort || smtp.port || 465) === 465,
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
            console.log(`[Generic] Sent to ${to}: ${info.messageId}`);
            return true;
        } catch (error) {
            console.error(`[Generic] Send Error (${this.account.email}):`, error.message);
            throw error;
        }
    }

    async rescueSpam(knownSenders) {
        let connection;
        let rescuedCount = 0;

        try {
            const imapConfig = this.account.imap || {};
            const config = {
                imap: {
                    user: this.account.email,
                    password: this.account.password,
                    host: this.account.imapHost || imapConfig.host,
                    port: this.account.imapPort || imapConfig.port || 993,
                    tls: true,
                    authTimeout: 10000
                }
            };

            connection = await imap.connect(config);
            // Folder names vary by provider (Junk, Spam, Bulk). We try 'Junk' then 'Spam'.
            let spamBox = 'Junk';
            try {
                await connection.openBox('Junk');
            } catch (e) {
                spamBox = 'Spam';
                await connection.openBox('Spam');
            }

            const searchCriteria = ['ALL'];
            const fetchOptions = { bodies: ['HEADER'], struct: true };

            const messages = await connection.search(searchCriteria, fetchOptions);

            for (const item of messages) {
                const headerPart = item.parts.find(part => part.which === 'HEADER');
                const headers = item.parts.find(part => part.which === 'HEADER').body;

                const fromHeader = headers.from ? headers.from[0] : '';

                const isFriend = knownSenders.some(friendEmail => fromHeader.includes(friendEmail));

                if (isFriend) {
                    console.log(`[Generic] Rescuing email from ${fromHeader}...`);

                    await connection.moveMessage(item.attributes.uid, 'INBOX');
                    await connection.addFlags(item.attributes.uid, ['\\Flagged']);

                    rescuedCount++;
                }
            }

        } catch (error) {
            // console.error(`[Generic] Rescue Error (${this.account.email}):`, error.message);
            // Suppress error if folder doesn't exist, as generic provider might be quirky
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

module.exports = GenericDriver;
