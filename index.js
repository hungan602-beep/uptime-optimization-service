
/**
 * Network Monitor v3.4 - Main Orchestrator
 */
const fs = require('fs');
const path = require('path');
const process = require('process');

// Core Modules
const StateManager = require('./core/state_manager');
const Scheduler = require('./core/scheduler');
const Topology = require('./core/topology');

// Drivers
const GmailDriver = require('./drivers/gmail');
const MicrosoftDriver = require('./drivers/microsoft');
const GenericDriver = require('./drivers/generic');

// Content
const ContentGenerator = require('./content/generator');

// Configuration
const ACCOUNTS_FILE = path.join(__dirname, 'config/accounts.json');

async function main() {
    console.log("=== Network Monitor v3.4 Started ===");

    // 1. Load Accounts
    if (!fs.existsSync(ACCOUNTS_FILE)) {
        console.error("No accounts.json found in config/");
        process.exit(1);
    }
    const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    console.log(`Loaded ${accounts.length} accounts.`);

    // 2. Main Loop
    for (const account of accounts) {
        console.log(`\n--- Processing Node: ${account.email} ---`);

        let driver = null;
        const state = StateManager.getAccountState(account.email);

        // A. Health & Cooldown Check
        if (StateManager.isCooldown(account.email)) {
            console.log(`[SKIP] Account is in cooldown until ${state.cooldown_until}.`);
            continue;
        }

        // B. Initialize Driver
        try {
            switch (account.type) {
                case 'gmail': driver = new GmailDriver(account); break;
                case 'microsoft': driver = new MicrosoftDriver(account); break;
                case 'generic': driver = new GenericDriver(account); break;
                default: console.error(`Unknown type: ${account.type}`); continue;
            }

            // Health Check (Optional - can be expensive, maybe skip every run?)
            // const health = await driver.healthCheck();
            // if (health.status !== 'ok') throw new Error(health.error);

        } catch (e) {
            console.error(`[ERROR] Init Failed: ${e.message}`);
            // Trigger Cooldown
            StateManager.updateAccount(account.email, {
                status: 'cooldown',
                cooldown_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            });
            continue;
        }

        try {
            // C. Recovery Cycle (Priority 1)
            // Friend List: All other emails in accounts.json
            const friendList = accounts.map(a => a.email).filter(e => e !== account.email);
            const recovered = await driver.rescueSpam(friendList);
            if (recovered > 0) {
                console.log(`[RECOVER] Saved ${recovered} emails.`);
                StateManager.updateAccount(account.email, { recovered_today: (state.recovered_today || state.rescued_today || 0) + recovered });
            }

            // D. Pending Replies (Priority 2)
            // Check state for pending replies scheduled for NOW or past
            // TODO: Implement pending_replies array in state_manager (simple queue)
            // For v3.4 MVP, skipping complex persistent queue logic to keep file size small.
            // Start simple: If we see a recovered email, we *could* reply immediately or set a flag.
            // Let's stick to the plan: "Schedule Reply". 
            // Implementation: We won't code the full queue logic *in this file* to keep it readable, 
            // but conceptually it goes here.

            // E. Outbound Sending (Priority 3)
            // 1. Working Hours Check
            if (!Scheduler.isWorkingHour(account.timezone)) {
                console.log(`[SKIP] Outside working hours (Timezone: ${account.timezone || 'UTC'}).`);
            } else {
                // 2. Daily Limit Check
                // Smart Ramp-up: min(30, days_active * 1.5)
                const daysActive = Math.floor((Date.now() - new Date(account.start_date || Date.now()).getTime()) / (1000 * 60 * 60 * 24)) || 1;
                const dailyLimit = Math.min(30, Math.ceil(daysActive * 1.5));

                if (state.sent_today >= dailyLimit) {
                    console.log(`[SKIP] Daily limit reached (${state.sent_today}/${dailyLimit}).`);
                } else {
                    // 3. Select Peer
                    const target = Topology.selectPeer(account, accounts, StateManager);
                    if (target) {
                        // 4. Generate Content
                        const subject = ContentGenerator.generateSubject("Project Alpha");
                        const body = ContentGenerator.generateBody(account.email, "Acme Corp");

                        // 5. Send
                        await driver.sendEmail(target.email, subject, body);

                        // 6. Update State
                        StateManager.updateAccount(account.email, {
                            sent_today: (state.sent_today || 0) + 1,
                            last_run: new Date().toISOString()
                        });

                        // 7. Schedule Reply (Simulated)
                        // In a real DB, we'd add { from: target.email, to: account.email, trigger: now + 3h } to a 'jobs' table.
                        console.log(`[SCHEDULE] Reply expected from ${target.email} in 2-4 hours.`);
                    } else {
                        console.log(`[SKIP] No suitable peer found.`);
                    }
                }
            }

        } catch (e) {
            console.error(`[ERROR] Runtime Error: ${e.message}`);
            // If error is auth related, cooldown.
            StateManager.updateAccount(account.email, {
                status: 'cooldown',
                cooldown_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            });
        } finally {
            // Cleanup connection
            if (driver && driver.close) await driver.close();
        }
    }

    // 3. Save State
    StateManager.save();
    console.log("=== Cycle Complete. State Saved. ===");
}

main();
