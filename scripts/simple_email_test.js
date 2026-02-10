const fs = require('fs');
const path = require('path');
const GenericDriver = require('../drivers/generic.js');

const ACCOUNTS_FILE = path.join(__dirname, '../config/accounts.json');
const TARGET_SENDER = 'info@eforemys.com.tr';
const RECIPIENT = 'shahidjaved832@gmail.com';

async function run() {
    console.log("Loading accounts...");
    const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));

    const senderAccount = accounts.find(a => a.username === TARGET_SENDER || a.email === TARGET_SENDER);

    if (!senderAccount) {
        console.error(`Sender account ${TARGET_SENDER} not found!`);
        process.exit(1);
    }

    // Normalize email if missing
    if (!senderAccount.email) senderAccount.email = senderAccount.username;

    console.log(`Initializing driver for ${senderAccount.email}...`);
    const driver = new GenericDriver(senderAccount);

    console.log(`Attempting to send email to ${RECIPIENT}...`);
    try {
        const result = await driver.sendEmail(
            RECIPIENT,
            "Manual Test: Connectivity Check",
            "<p>This is a manual test to verify SMTP connectivity from the simple script.</p>"
        );

        if (result) {
            console.log("✅ SUCCESS: Email sent successfully.");
        } else {
            console.error("❌ FAILED: Driver returned false.");
        }
    } catch (e) {
        console.error("❌ EXCEPTION:", e);
    } finally {
        // Driver doesn't always need close, but good practice if it did
        console.log("Done.");
    }
}

run();
