const fs = require('fs');
const path = require('path');
const http = require('http');

const ACCOUNTS_FILE = path.join(__dirname, '../config/accounts.json');

// 1. Load Accounts
if (!fs.existsSync(ACCOUNTS_FILE)) {
    console.error("No accounts.json found!");
    process.exit(1);
}

const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));

// 2. Select 5 of each type
const gmail = accounts.filter(a => a.type === 'gmail').slice(0, 5);
const microsoft = accounts.filter(a => a.type === 'microsoft').slice(0, 5);
const generic = accounts.filter(a => a.type === 'generic').slice(0, 5);

const selected = [...gmail, ...microsoft, ...generic];
const targets = selected.map(a => a.username);

console.log(`Selected ${targets.length} accounts:`);
console.log(`- Gmail: ${gmail.length}`);
console.log(`- Outlook: ${microsoft.length}`);
console.log(`- Generic: ${generic.length}`);
console.log("Targets:", targets);

if (targets.length === 0) {
    console.error("No targets selected!");
    process.exit(1);
}

// 3. Trigger Launch via Local API
const data = JSON.stringify({ targets });

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/github-launch',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = http.request(options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
        console.log(`\nResponse Code: ${res.statusCode}`);
        console.log(`Response Body: ${body}`);
    });
});

req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
});

req.write(data);
req.end();
