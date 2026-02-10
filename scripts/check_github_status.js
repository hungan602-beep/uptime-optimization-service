const fs = require('fs');
const path = require('path');
const https = require('https');

const GIT_CONFIG = path.join(__dirname, '../.git/config');
const TOKEN_FILE = path.join(__dirname, '../config/gh_token');

// 1. Get Token & Repo
function getCredentials() {
    let token = null;
    let repo = null;

    // Check .git/config
    if (fs.existsSync(GIT_CONFIG)) {
        const content = fs.readFileSync(GIT_CONFIG, 'utf8');
        const urlMatch = content.match(/url\s*=\s*https:\/\/([^@]+)@github\.com\/([^\/]+\/[^.]+)\.?git?/);
        if (urlMatch) {
            token = urlMatch[1];
            repo = urlMatch[2].replace(/\.git$/, '');
        }
    }

    // Fallback to token file
    if (!token && fs.existsSync(TOKEN_FILE)) {
        token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    }

    // Fallback repo default
    if (!repo) repo = 'KosenkoMax/network-latency-monitor';

    return { token, repo };
}

const { token, repo } = getCredentials();

if (!token) {
    console.error("No GitHub token found!");
    process.exit(1);
}

console.log(`Checking status for: ${repo}`);

// 2. Fetch Runs
const options = {
    hostname: 'api.github.com',
    path: `/repos/${repo}/actions/runs?per_page=5`,
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
            console.error(`API Error: ${res.statusCode} - ${body}`);
            return;
        }

        const data = JSON.parse(body);
        const runs = data.workflow_runs;

        if (runs.length === 0) {
            console.log("No workflow runs found.");
            return;
        }

        console.log("\nLatest 5 Workflow Runs:");
        runs.forEach(run => {
            const time = new Date(run.created_at).toLocaleString();
            console.log(`- [${run.status.toUpperCase()}] ${run.name} (${run.conclusion || 'running'})`);
            console.log(`  ID: ${run.id} | Branch: ${run.head_branch} | Time: ${time}`);
            console.log(`  URL: ${run.html_url}\n`);
        });
    });
});

req.on('error', (e) => {
    console.error(`Request Error: ${e.message}`);
});

req.end();
