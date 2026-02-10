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
console.log(`Checking file in: ${repo}`);

const options = {
    hostname: 'api.github.com',
    path: `/repos/${repo}/contents/.github/workflows/e2e-tests.yml`,
    method: 'GET',
    headers: {
        'User-Agent': 'Node.js',
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
    }
};

const req = https.request(options, (res) => {
    console.log(`Response Code: ${res.statusCode}`);
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
        if (res.statusCode === 200) {
            console.log("File exists on remote!");
            const data = JSON.parse(body);
            console.log("SHA:", data.sha);
        } else {
            console.log("File NOT found or error:", body);
        }
    });
});

req.on('error', (e) => console.error(e));
req.end();
