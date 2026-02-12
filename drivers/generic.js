
const BaseDriver = require('../core/driver_interface');
const nodemailer = require('nodemailer');
const imap = require('imap-simple');
const { simpleParser } = require('mailparser');

const Socks = require('socks').SocksClient;
const proxyConfig = require('../config/proxy');

class GenericDriver extends BaseDriver {
    constructor(account) {
        super(account);
        const smtp = this.account.smtp || {};

        const transportConfig = {
            host: this.account.smtpHost || smtp.host,
            port: this.account.smtpPort || smtp.port || 465,
            secure: (this.account.smtpPort || smtp.port || 465) === 465,
            auth: {
                user: this.account.email,
                pass: this.account.password
            },
            tls: {
                rejectUnauthorized: false
            },
            connectionTimeout: 15000,
            greetingTimeout: 15000,
            socketTimeout: 30000
        };

        // Inject Proxy if enabled
        if (proxyConfig.enabled) {
            console.log(`[Generic] Using Proxy: ${proxyConfig.host}`);
            transportConfig.pool = true;
            transportConfig.getSocket = (options, callback) => {
                const destination = {
                    host: options.host,
                    port: options.port
                };

                Socks.createConnection({
                    proxy: {
                        ipaddress: proxyConfig.host,
                        port: proxyConfig.port,
                        type: 5,
                        userId: proxyConfig.userId,
                        password: proxyConfig.password
                    },
                    command: 'connect',
                    destination: destination,
                    timeout: 10000
                }, (err, info) => {
                    if (err) {
                        console.error(`[Proxy] Connection Error to ${destination.host}:`, err.message);
                        return callback(err);
                    }
                    callback(null, info.socket);
                });
            };
        }

        this.transporter = nodemailer.createTransport(transportConfig);
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
                    tlsOptions: { rejectUnauthorized: false },
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

    async engageInbox(knownSenders) {
        let connection;
        const result = { read: 0, starred: 0, replied: 0 };
        const ContentGenerator = require('../content/generator');
        const REPLY_CHANCE = 0.7;

        try {
            const imapConfig = this.account.imap || {};
            const config = {
                imap: {
                    user: this.account.email,
                    password: this.account.password,
                    host: this.account.imapHost || imapConfig.host,
                    port: this.account.imapPort || imapConfig.port || 993,
                    tls: true,
                    tlsOptions: { rejectUnauthorized: false },
                    authTimeout: 15000
                }
            };

            connection = await imap.connect(config);
            await connection.openBox('INBOX');

            const messages = await connection.search(['ALL'], { bodies: ['HEADER'], struct: true });
            const recent = messages.slice(-50);

            // Detect sent folder name (varies by provider)
            let sentFolder = 'Sent';
            try { await connection.openBox('Sent'); } catch (e) {
                try { await connection.openBox('INBOX.Sent'); sentFolder = 'INBOX.Sent'; } catch (e2) {
                    sentFolder = null; // Can't find sent folder — skip replies
                }
            }
            // Re-open INBOX
            await connection.openBox('INBOX');

            for (const msg of recent) {
                try {
                    const headers = msg.parts.find(p => p.which === 'HEADER').body;
                    const fromHeader = headers.from ? headers.from[0] : '';
                    const subject = headers.subject ? headers.subject[0] : '';
                    const messageId = headers['message-id'] ? headers['message-id'][0] : '';
                    const uid = msg.attributes.uid;
                    const flags = msg.attributes.flags || [];

                    const isFriend = knownSenders.some(f => fromHeader.includes(f));
                    if (!isFriend) continue;

                    // Mark as Read
                    if (!flags.includes('\\Seen')) {
                        await connection.addFlags(uid, ['\\Seen']);
                        result.read++;
                    }

                    // Star
                    if (!flags.includes('\\Flagged')) {
                        await connection.addFlags(uid, ['\\Flagged']);
                        result.starred++;
                    }

                    // Reply (30% chance)
                    if (Math.random() < REPLY_CHANCE && messageId && sentFolder) {
                        const replyBody = ContentGenerator.generateReply(subject);
                        const senderEmail = fromHeader.match(/<(.+?)>/) ? fromHeader.match(/<(.+?)>/)[1] : fromHeader;

                        const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
                        const rawMsg = [
                            `From: ${this.account.email}`,
                            `To: ${senderEmail}`,
                            `Subject: ${replySubject}`,
                            `In-Reply-To: ${messageId}`,
                            `References: ${messageId}`,
                            `Date: ${new Date().toUTCString()}`,
                            `MIME-Version: 1.0`,
                            `Content-Type: text/plain; charset=utf-8`,
                            ``,
                            replyBody
                        ].join('\r\n');

                        try {
                            await connection.append(rawMsg, { mailbox: sentFolder, flags: ['\\Seen'] });
                            result.replied++;
                            console.log(`[Generic] 💬 Replied to ${senderEmail.substring(0, 20)}...`);
                        } catch (appendErr) {
                            // Non-fatal
                        }
                    }
                } catch (msgErr) { }
            }
        } catch (error) {
            // Suppress — generic providers can be quirky
        } finally {
            if (connection) try { connection.end(); } catch (e) { }
        }
        return result;
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
