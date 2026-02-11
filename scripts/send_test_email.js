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
    if (!repo) repo = 'hungan602-beep/uptime-optimization-service';
    return { token, repo };
}

const { token, repo } = getCredentials();

const payload = JSON.stringify({
    ref: 'main',
    inputs: {
        test_subset: 'info@eforemys.com.tr', // The sender (Generic account)
        recipient: 'muhammadriaz389900@gmail.com', // The manual recipient
        proxy_url: '',  // Optional proxy
        matrix_count: '1' // Trigger 1 shard per OS
    }
});

const options = {
    hostname: 'api.github.com',
    path: `/repos/${repo}/actions/workflows/e2e-tests.yml/dispatches`,
    method: 'POST',
    headers: {
        'User-Agent': 'Node.js',
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'Content-Length': payload.length
    }
};

console.log(`Triggering workflow on ${repo}...`);
console.log(`Sender: info@eforemys.com.tr`);
console.log(`Recipient: muhammadriaz389900@gmail.com`);
console.log(`Strategy: Multi-OS (Ubuntu + Windows)`);

const req = https.request(options, (res) => {
    if (res.statusCode === 204) {
        console.log("Successfully triggered workflow!");
    } else {
        console.error(`Failed to trigger workflow: ${res.statusCode}`);
        res.on('data', d => process.stdout.write(d));
    }
});

req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
});

req.write(payload);
req.end();
