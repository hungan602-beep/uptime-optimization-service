const fs = require('fs');
const path = require('path');
const https = require('https');

const GIT_CONFIG = path.join(__dirname, '../.git/config');
const TOKEN_FILE = path.join(__dirname, '../config/gh_token');

function getCredentials() {
    let token = null;
    let repo = null;
    if (fs.existsSync(GIT_CONFIG)) {
        const content = fs.readFileSync(GIT_CONFIG, 'utf8');
        const urlMatch = content.match(/url\s*=\s*https:\/\/([^@]+)@github\.com\/([^\/]+\/[^.]+)\.?git?/);
        if (urlMatch) {
            token = urlMatch[1];
            repo = urlMatch[2].replace(/\.git$/, '');
        }
    }
    if (!token && fs.existsSync(TOKEN_FILE)) {
        token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    }
    if (!repo) repo = 'KosenkoMax/network-latency-monitor';
    return { token, repo };
}

const { token, repo } = getCredentials();
console.log(`Checking: ${repo}`);

const options = {
    hostname: 'api.github.com',
    path: `/repos/${repo}/actions/runs?per_page=20`,
    method: 'GET',
    headers: {
        'User-Agent': 'Node.js',
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
    }
};

const req = https.request(options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
        if (res.statusCode !== 200) {
            console.error(`API Error: ${res.statusCode}`);
            return;
        }
        const data = JSON.parse(body);
        console.log(`Total Runs: ${data.total_count}`);

        const runs = data.workflow_runs || [];
        if (runs.length === 0) {
            console.log("No runs.");
        } else {
            console.log("Top 10 Runs:");
            runs.slice(0, 10).forEach(run => {
                console.log(`[${run.name}] #${run.run_number} (${run.status} - ${run.conclusion}) ID:${run.id} @ ${run.created_at}`);
            });
        }
    });
});

req.on('error', (e) => console.error(e));
req.end();
