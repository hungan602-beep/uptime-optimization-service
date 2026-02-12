
const BaseDriver = require('../core/driver_interface');
const nodemailer = require('nodemailer');
const imap = require('imap-simple');
const { simpleParser } = require('mailparser');

const Socks = require('socks').SocksClient;
const proxyConfig = require('../config/proxy');

class GmailDriver extends BaseDriver {
    constructor(account) {
        super(account);

        // Gmail Standard Config (Port 587 for SOCKS compatibility)
        const transportConfig = {
            host: 'smtp.gmail.com',
            port: 587,
            secure: false, // upgrades to TLS via STARTTLS
            auth: {
                user: this.account.email,
                pass: this.account.password
            }
        };

        // Inject Proxy if enabled
        if (proxyConfig.enabled) {
            console.log(`[Gmail] Using Proxy: ${proxyConfig.host}`);
            // When using 'service: gmail', host need not be defined, but for SOCKS we might need explicit host?
            // Nodemailer resolves 'gmail' to smtp.gmail.com.
            // Let's force pool and getSocket.
            transportConfig.pool = true;
            transportConfig.getSocket = (options, callback) => {
                // Nodemailer might pass 'smtp.gmail.com' or similar in options
                // If options.host is undefined, we default to smtp.gmail.com
                const host = options.host || 'smtp.gmail.com';
                const port = options.port || 465;

                Socks.createConnection({
                    proxy: {
                        ipaddress: proxyConfig.host,
                        port: proxyConfig.port,
                        type: 5,
                        userId: proxyConfig.userId,
                        password: proxyConfig.password
                    },
                    command: 'connect',
                    destination: { host, port }
                }, (err, info) => {
                    if (err) {
                        console.error(`[Proxy] Gmail Connection Error:`, err.message);
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
                    tlsOptions: { rejectUnauthorized: false },
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

    async engageInbox(knownSenders) {
        let connection;
        const result = { read: 0, starred: 0, replied: 0 };
        const ContentGenerator = require('../content/generator');
        const REPLY_CHANCE = 0.7; // 70% chance to reply

        try {
            const config = {
                imap: {
                    user: this.account.email,
                    password: this.account.password,
                    host: 'imap.gmail.com',
                    port: 993,
                    tls: true,
                    tlsOptions: { rejectUnauthorized: false },
                    authTimeout: 15000
                }
            };

            connection = await imap.connect(config);
            await connection.openBox('INBOX');

            // Fetch recent 50 messages
            const searchCriteria = ['ALL'];
            const fetchOptions = { bodies: ['HEADER'], struct: true };
            const messages = await connection.search(searchCriteria, fetchOptions);
            const recent = messages.slice(-50);

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

                    // Mark as Read (if not already)
                    if (!flags.includes('\\Seen')) {
                        await connection.addFlags(uid, ['\\Seen']);
                        result.read++;
                    }

                    // Star (if not already)
                    if (!flags.includes('\\Flagged')) {
                        await connection.addFlags(uid, ['\\Flagged']);
                        result.starred++;
                    }

                    // Reply (30% chance, skip if already replied)
                    if (Math.random() < REPLY_CHANCE && messageId) {
                        const replyBody = ContentGenerator.generateReply(subject);
                        const senderEmail = fromHeader.match(/<(.+?)>/) ? fromHeader.match(/<(.+?)>/)[1] : fromHeader;

                        // Build raw reply message with threading headers
                        const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
                        const boundary = `----=_Part_${Date.now()}`;
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

                        // Append to Sent Mail (creates the reply in the thread)
                        try {
                            await connection.append(rawMsg, { mailbox: '[Gmail]/Sent Mail', flags: ['\\Seen'] });
                            result.replied++;
                            console.log(`[Gmail] 💬 Replied to ${senderEmail.substring(0, 20)}...`);
                        } catch (appendErr) {
                            // Non-fatal — some folders may not allow append
                        }
                    }
                } catch (msgErr) {
                    // Skip individual message errors
                }
            }
        } catch (error) {
            console.error(`[Gmail] Engage Error (${this.account.email}):`, error.message);
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

module.exports = GmailDriver;
