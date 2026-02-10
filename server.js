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
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Control State (Runtime override)
const runtimeFlags = {};

// --- API Endpoints ---

// 1. Get Status (Poll)
app.get('/api/status', (req, res) => {
    try {
        const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
        const currentState = StateManager.state;

        const enriched = accounts.map(acc => {
            const s = currentState[acc.username] || {};
            return {
                email: acc.username,
                type: acc.type,
                metrics: {
                    sent: s.sent_today || 0,
                    rescued: s.rescued_today || 0,
                    limit: s.daily_limit || 30, // Default MVP limit
                    warmup_day: s.warmup_day || 1
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
            StateManager.updateAccount(email, { sent_today: 0, rescued_today: 0 });
        }
    });

    res.json({ success: true, affected: targets.length });
});

// Serve the NEW Dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard_v2.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`Universal Warmer Control Server running on http://localhost:${PORT}`);
    console.log(`(Rollback available: 'node index.js' for CLI mode)`);
});
