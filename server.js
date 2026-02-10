const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = 3000;

// Core Engine
const StateManager = require('./core/state_manager');
const ACCOUNTS_FILE = path.join(__dirname, 'config/accounts.json');

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Control State (Runtime override)
const runtimeFlags = {};

// --- API Endpoints ---

// 0. Import Accounts (Overwrite or Append)
app.post('/api/import', (req, res) => {
    try {
        const { accounts, mode } = req.body;
        // Support legacy format (just array) or new format { accounts: [], mode: 'overwrite' }
        let newAccounts = Array.isArray(req.body) ? req.body : accounts;
        const importMode = mode || 'overwrite'; // 'overwrite' | 'append'

        if (!Array.isArray(newAccounts)) {
            return res.status(400).json({ error: "Input must be a JSON array [...]." });
        }

        // Basic validation of first item
        if (newAccounts.length > 0 && (!newAccounts[0].username || !newAccounts[0].password)) {
            return res.status(400).json({ error: "Invalid format. Objects must have username and password." });
        }

        let finalAccounts = [];

        if (importMode === 'append') {
            // Read existing file
            let existingAccounts = [];
            try {
                if (fs.existsSync(ACCOUNTS_FILE)) {
                    const data = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
                    existingAccounts = JSON.parse(data);
                }
            } catch (err) {
                console.warn("Could not read existing accounts for append, starting fresh.", err);
            }

            // Merge Logic: Create Map by username (normalize to lowercase)
            // Use existing accounts as the base
            const accountMap = new Map();
            existingAccounts.forEach(acc => {
                if (acc.username) accountMap.set(acc.username.toLowerCase(), acc);
            });

            // Merge new accounts (overwrite existing entries in map)
            newAccounts.forEach(acc => {
                if (acc.username) accountMap.set(acc.username.toLowerCase(), acc);
            });

            finalAccounts = Array.from(accountMap.values());
            console.log(`[Import] Appended ${newAccounts.length} accounts. Total now: ${finalAccounts.length}`);

        } else {
            // Overwrite mode
            finalAccounts = newAccounts;
            console.log(`[Import] Overwrote list with ${finalAccounts.length} accounts.`);
        }

        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(finalAccounts, null, 2));

        res.json({
            success: true,
            count: finalAccounts.length,
            message: `Successfully imported ${newAccounts.length} accounts (${importMode}). Total: ${finalAccounts.length}`
        });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 1. Get Status (Poll)
app.get('/api/status', (req, res) => {
    try {
        const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
        const currentState = StateManager.state;

        const enriched = accounts.map(acc => {
            const s = currentState[acc.username] || {};
            // Backwards compatibility with old state files
            const recoveredCount = s.recovered_today || s.rescued_today || 0;
            const calibrationDay = s.calibration_day || s.warmup_day || 1;

            return {
                email: acc.username,
                type: acc.type,
                metrics: {
                    sent: s.sent_today || 0,
                    recovered: recoveredCount,
                    limit: s.daily_limit || 30, // Default MVP limit
                    calibration_day: calibrationDay
                },
                status: runtimeFlags[acc.username]?.status || s.status || 'active',
                lastRange: s.last_run
            };
        });

        res.json({ system: 'online', accounts: enriched });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2. Control Action (Start/Stop/Reset)
app.post('/api/control', (req, res) => {
    const { action, targets } = req.body; // targets = ['email1', 'email2']

    if (!targets || !Array.isArray(targets)) return res.status(400).json({ error: "Invalid targets" });

    targets.forEach(email => {
        if (action === 'stop') {
            runtimeFlags[email] = { status: 'paused' };
            // Persist to state so it survives restart
            StateManager.updateAccount(email, { status: 'paused' });
        } else if (action === 'start') {
            delete runtimeFlags[email];
            StateManager.updateAccount(email, { status: 'active' });
        } else if (action === 'reset_stats') {
            StateManager.updateAccount(email, { sent_today: 0, recovered_today: 0, rescued_today: 0 });
        }
    });

    res.json({ success: true, affected: targets.length });
});



const https = require('https');
const { exec } = require('child_process');

app.post('/api/github-launch', (req, res) => {
    try {
        const { targets } = req.body;
        console.log(`[GitHub Launch] Request for ${targets.length} targets.`);

        // 1. Get Token from Git Remote
        exec('git remote -v', (err, stdout, stderr) => {
            if (err) {
                console.error("Git Remote Error:", err);
                return res.status(500).json({ error: "Failed to read git remote." });
            }

            // Extract token: https://TOKEN@github.com...
            const match = stdout.match(/https:\/\/([^@]+)@github\.com/);
            if (!match || !match[1]) {
                return res.status(500).json({ error: "No GitHub token found in git remote." });
            }
            const token = match[1];

            // 2. Call GitHub API
            const data = JSON.stringify({
                ref: 'main',
                inputs: {
                    targets: targets.join(',')
                }
            });

            const options = {
                hostname: 'api.github.com',
                path: '/repos/KosenkoMax/network-latency-monitor/actions/workflows/warmup.yml/dispatches',
                method: 'POST',
                headers: {
                    'User-Agent': 'Node.js',
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                    'Content-Length': data.length
                }
            };

            const ghReq = https.request(options, (ghRes) => {
                let body = '';
                ghRes.on('data', chunk => body += chunk);
                ghRes.on('end', () => {
                    if (ghRes.statusCode >= 200 && ghRes.statusCode < 300) {
                        res.json({ success: true, message: "Workflow dispatched.", run_id: "queued" });
                    } else {
                        console.error("GitHub API Error:", ghRes.statusCode, body);
                        res.status(500).json({ error: `GitHub API Error: ${ghRes.statusCode} - ${body}` });
                    }
                });
            });

            ghReq.on('error', (e) => {
                console.error("Request Error:", e);
                res.status(500).json({ error: e.message });
            });

            ghReq.write(data);
            ghReq.end();
        });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Network Monitor Control Server running on http://localhost:${PORT}`);
    console.log(`(Rollback available: 'node index.js' for CLI mode)`);
});
