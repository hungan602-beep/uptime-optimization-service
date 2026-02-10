const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');

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

// 1. Get Latest Stealth Run
const runsOptions = {
    hostname: 'api.github.com',
    path: `/repos/${repo}/actions/workflows/e2e-tests.yml/runs?per_page=1`,
    method: 'GET',
    headers: {
        'User-Agent': 'Node.js',
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
    }
};

const req = https.request(runsOptions, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
        if (res.statusCode !== 200) {
            console.error(`Runs API Error: ${res.statusCode}`);
            return;
        }
        const data = JSON.parse(body);
        const runs = data.workflow_runs;
        if (!runs || runs.length === 0) {
            console.log("No runs found.");
            return;
        }
        const latestRun = runs[0];
        console.log(`Analyzing Run #${latestRun.run_number} (${latestRun.status} - ${latestRun.conclusion})`);

        // 2. Get Jobs for Run
        const jobsUrl = latestRun.jobs_url;
        // jobsUrl is full url, e.g. https://api.github.com/repos/...
        // We need path only or use full url via https

        // Let's use curl for simplicity to follow redirects and handle full URLs
        // Fetch Jobs
        console.log(`Fetching jobs from: ${jobsUrl}`);
        exec(`curl -H "Authorization: token ${token}" -H "Accept: application/vnd.github.v3+json" "${jobsUrl}"`, (err, stdout, stderr) => {
            if (err) {
                console.error("Curl error (jobs):", err);
                return;
            }
            const jobsData = JSON.parse(stdout);
            const jobs = jobsData.jobs || [];
            if (jobs.length === 0) {
                console.log("No jobs found.");
                return;
            }

            // Find the job
            const job = jobs.find(j => j.name === "Integration Tests (Matrix)");
            if (!job) {
                console.log("Job 'Integration Tests (Matrix)' not found. Available:", jobs.map(j => j.name));
                return;
            }

            console.log(`Found Job ID: ${job.id} (${job.status})`);

            // 3. Fetch Logs for Job
            // Endpoint: /repos/{owner}/{repo}/actions/jobs/{job_id}/logs
            const logsUrl = `https://api.github.com/repos/${repo}/actions/jobs/${job.id}/logs`;
            console.log(`Fetching logs from: ${logsUrl}`);

            // Use curl -L to follow redirects (GitHub logs redirect to Azure blob storage)
            exec(`curl -L -H "Authorization: token ${token}" "${logsUrl}" > job_logs.txt`, (err, stdout, stderr) => {
                if (err) {
                    console.error("Curl error (logs):", err);
                    return;
                }
                console.log("Logs saved to job_logs.txt");
            });
        });
    });
});
req.end();
