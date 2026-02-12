
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../state.json');

class StateManager {
    constructor() {
        this.state = {};
        this.load();
    }

    load() {
        if (fs.existsSync(STATE_FILE)) {
            try {
                this.state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            } catch (e) {
                console.error("Failed to load state.json, starting fresh.");
                this.state = {};
            }
        }
    }

    save() {
        fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
    }

    getAccountState(email) {
        if (!this.state[email]) {
            this.state[email] = {
                sent_today: 0,
                recovered_today: 0,
                replies_today: 0,
                engaged_today: 0,
                last_run: null,
                status: 'active',
                cooldown_until: null,
                bounces_today: 0
            };
        }
        return this.state[email];
    }

    updateAccount(email, updates) {
        const current = this.getAccountState(email);
        this.state[email] = { ...current, ...updates };
        this.save();
    }

    isCooldown(email) {
        const s = this.getAccountState(email);
        if (s.cooldown_until && new Date(s.cooldown_until) > new Date()) {
            return true;
        }
        // Auto-reset cooldown if time passed
        if (s.cooldown_until) {
            this.updateAccount(email, { cooldown_until: null, status: 'active' });
        }
        return false;
    }

    resetDailyStats() {
        // Only reset if it's a new day (UTC)
        // For simplicity, we can let the caller handle the logic or do it here.
        // Doing a blind reset might be dangerous if run multiple times.
        // Better: Check 'last_reset_date' property.
    }
}

module.exports = new StateManager();
