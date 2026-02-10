const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { exec } = require('child_process');

const app = express();
const PORT = 3000;

// Core Engine
const StateManager = require('./core/state_manager');
const ACCOUNTS_FILE = path.join(__dirname, 'config/accounts.json');
const TOKEN_FILE = path.join(__dirname, 'config/gh_token');
const GIT_CONFIG_FILE = path.join(__dirname, '.git/config');

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Control State (Runtime override)
const runtimeFlags = {};

// Helper: Launch Workflow
function launchWorkflow(token, repoPath, targets, res) {
    if (!repoPath) repoPath = 'KosenkoMax/network-latency-monitor'; // Fallback default

    const data = JSON.stringify({
        ref: 'main',
        inputs: {
            test_subset: targets.join(',')
        }
    });

    const options = {
        hostname: 'api.github.com',
        path: `/repos/${repoPath}/actions/workflows/e2e-tests.yml/dispatches`,
        method: 'POST',
        headers: {
            'User-Agent': 'Node.js',
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };

    console.log(`[GitHub Launch] Dispatching to ${repoPath}...`);

    const ghReq = https.request(options, (ghRes) => {
        let body = '';
        ghRes.on('data', chunk => body += chunk);
        ghRes.on('end', () => {
            if (ghRes.statusCode >= 200 && ghRes.statusCode < 300) {
                res.json({ success: true, message: `Workflow dispatched to ${repoPath}.`, run_id: "queued" });
            } else {
                console.error("GitHub API Error:", ghRes.statusCode, body);
                res.status(500).json({ error: `GitHub API Error: ${ghRes.statusCode} - ${body} (Repo: ${repoPath})` });
            }
        });
    });

    ghReq.on('error', (e) => {
        console.error("Request Error:", e);
        res.status(500).json({ error: e.message });
    });

    ghReq.write(data);
    ghReq.end();
}

// Helper: Scrape Token from .git/config (Fallback)
function getTokenFromGitConfig() {
    try {
        if (fs.existsSync(GIT_CONFIG_FILE)) {
            const content = fs.readFileSync(GIT_CONFIG_FILE, 'utf8');
            // Look for url = https://TOKEN@github.com
            const match = content.match(/url\s*=\s*https:\/\/([^@]+)@github\.com/);
            if (match && match[1]) return match[1];
        }
    } catch (e) {
        console.warn("Failed to read .git/config:", e.message);
    }
    return null;
}

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

// 3. GitHub Launch Endpoint
app.post('/api/github-launch', (req, res) => {
    try {
        const { targets, manualToken } = req.body;
        console.log(`[GitHub Launch] Request for ${targets.length} targets.`);

        // Step A: Determine Repository URL
        exec('git remote -v', (err, stdout, stderr) => {
            let repoPath = null;
            let gitRemoteToken = null;

            if (!err) {
                // Extract Repo Path: github.com/OWNER/REPO.git
                const repoMatch = stdout.match(/github\.com[:\/]([^\/]+\/[^.]+)(\.git)?/);
                if (repoMatch && repoMatch[1]) {
                    repoPath = repoMatch[1];
                }

                // Extract Token (Pattern 1): https://TOKEN@github.com
                const urlMatch = stdout.match(/https:\/\/([^@]+)@github\.com/);
                if (urlMatch && urlMatch[1]) gitRemoteToken = urlMatch[1];

                // Extract Token (Pattern 2): ghp_ in output
                if (!gitRemoteToken) {
                    const tokenMatch = stdout.match(/(ghp_[a-zA-Z0-9]+)/);
                    if (tokenMatch && tokenMatch[1]) gitRemoteToken = tokenMatch[1];
                }
            }

            // Fallback: Default Repo if not found
            if (!repoPath) repoPath = 'KosenkoMax/network-latency-monitor';

            console.log(`[GitHub Launch] Resolved Repo: ${repoPath}`);

            // Step B: Determine Token

            // Priority 0: Manual Input (and persist it)
            if (manualToken) {
                console.log("Using manual token.");
                try { fs.writeFileSync(TOKEN_FILE, manualToken.trim(), 'utf8'); } catch (e) { }
                launchWorkflow(manualToken, repoPath, targets, res);
                return;
            }

            // Priority 1: Persisted Token File
            if (fs.existsSync(TOKEN_FILE)) {
                try {
                    const storedToken = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
                    if (storedToken.length > 10) {
                        console.log("Using persisted token from file.");
                        launchWorkflow(storedToken, repoPath, targets, res);
                        return;
                    }
                } catch (e) { }
            }

            // Priority 2: Extracted from Git Remote
            if (gitRemoteToken) {
                console.log("Using token from git remote.");
                launchWorkflow(gitRemoteToken, repoPath, targets, res);
                return;
            }

            // Priority 3: Scrape from .git/config (Magical Fallback)
            const configToken = getTokenFromGitConfig();
            if (configToken) {
                console.log("Using token scraped from .git/config.");
                // Launch immediately
                launchWorkflow(configToken, repoPath, targets, res);
                return;
            }

            // Failed
            console.error("No token found anywhere.");
            return res.status(500).json({ error: "No GitHub token found in git remote, config, or file. Please ensure you pushed with a PAT." });
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
