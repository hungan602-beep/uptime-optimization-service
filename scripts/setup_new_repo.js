const fs = require('fs');
const path = require('path');
const https = require('https');

const GIT_CONFIG = path.join(__dirname, '../.git/config');
const TOKEN_FILE = path.join(__dirname, '../config/gh_token');

function getToken() {
    let token = null;
    if (fs.existsSync(GIT_CONFIG)) {
        const content = fs.readFileSync(GIT_CONFIG, 'utf8');
        const urlMatch = content.match(/url\s*=\s*https:\/\/([^@]+)@github\.com\/([^\/]+\/[^.]+)\.?git?/);
        if (urlMatch) {
            token = urlMatch[1];
        }
    }
    if (!token && fs.existsSync(TOKEN_FILE)) {
        token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    }
    return token;
}

const token = getToken();
const NEW_REPO_NAME = 'uptime-optimization-service';

if (!token) {
    console.error("No gh_token found in config or git remote!");
    process.exit(1);
}

const data = JSON.stringify({
    name: NEW_REPO_NAME,
    private: false, // Must be public for free Actions runners usually, or private if user has billing
    description: "Automated service availability and latency optimization system",
    auto_init: false
});

const options = {
    hostname: 'api.github.com',
    path: '/user/repos',
    method: 'POST',
    headers: {
        'User-Agent': 'Node.js',
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

console.log(`Creating new repository: ${NEW_REPO_NAME}...`);

const req = https.request(options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
        if (res.statusCode === 201) {
            console.log(`Successfully created repo: ${NEW_REPO_NAME}`);
            const resp = JSON.parse(body);
            console.log(`Clone URL: ${resp.clone_url}`);
            // Output for the next step to capture
            console.log(`REPO_URL=${resp.clone_url}`);
            console.log(`REPO_FULL_NAME=${resp.full_name}`);
        } else {
            console.error(`Failed to create repo: ${res.statusCode}`);
            console.error(body);
        }
    });
});

req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
});

req.write(data);
req.end();
