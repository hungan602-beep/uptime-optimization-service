const fs = require('fs');
const path = require('path');
const https = require('https');

const GIT_CONFIG = path.join(__dirname, '../.git/config');
const TOKEN_FILE = path.join(__dirname, '../config/gh_token');

// 1. Get Token & Repo
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

console.log(`Manual Trigger for: ${repo}`);
console.log(`Token Length: ${token ? token.length : 0}`);

if (!token) {
    console.error("No token found!");
    process.exit(1);
}

// 2. Trigger Workflow
const data = JSON.stringify({
    ref: 'main',
    inputs: {
        targets: 'manual_debug_test'
    }
});

const options = {
    hostname: 'api.github.com',
    path: `/repos/${repo}/actions/workflows/warmup.yml/dispatches`,
    method: 'POST',
    headers: {
        'User-Agent': 'Node.js',
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = https.request(options, (res) => {
    console.log(`\nResponse Code: ${res.statusCode}`);
    console.log("Headers:", JSON.stringify(res.headers, null, 2));

    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
        console.log("Body:", body);
    });
});

req.on('error', (e) => {
    console.error(`Request Error: ${e.message}`);
});

req.write(data);
req.end();
