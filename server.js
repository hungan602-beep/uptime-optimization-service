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

// 0. Import Accounts (Overwrite)
app.post('/api/import', (req, res) => {
    try {
        const newAccounts = req.body;
        if (!Array.isArray(newAccounts)) {
            return res.status(400).json({ error: "Input must be a JSON array [...]." });
        }

        // Basic validation of first item
        if (newAccounts.length > 0 && (!newAccounts[0].username || !newAccounts[0].password)) {
            return res.status(400).json({ error: "Invalid format. Objects must have username and password." });
        }

        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(newAccounts, null, 2));
        res.json({ success: true, count: newAccounts.length });
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



// Start Server
app.listen(PORT, () => {
    console.log(`Network Monitor Control Server running on http://localhost:${PORT}`);
    console.log(`(Rollback available: 'node index.js' for CLI mode)`);
});
