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

    if (!repo) repo = 'KosenkoMax/network-latency-monitor'; // Fallback
    return { token, repo };
}

const { token, repo } = getCredentials();
const RUN_ID = '21866771815'; // Updated for most recent failure

console.log(`Debugging Run ID: ${RUN_ID} for Repo: ${repo}`);

// 2. Fetch Jobs
const options = {
    hostname: 'api.github.com',
    path: `/repos/${repo}/actions/runs/${RUN_ID}/jobs`,
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
        const jobs = data.jobs || [];

        if (jobs.length === 0) {
            console.log("No jobs found.");
            return;
        }

        jobs.forEach(job => {
            console.log(`\nJob: ${job.name} (${job.conclusion})`);

            job.steps.forEach(step => {
                console.log(`  - [${step.conclusion ? step.conclusion.toUpperCase() : 'SKIPPED'}] ${step.name}`);
                if (step.conclusion === 'failure') {
                    console.log(`    !!! PROBABLE CAUSE !!!`);
                }
            });
        });
    });
});

req.on('error', (e) => {
    console.error(`Request Error: ${e.message}`);
});

req.end();
