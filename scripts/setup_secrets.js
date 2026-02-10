
const fs = require('fs');
const path = require('path');

const ACCOUNTS_FILE = path.join(__dirname, '../config/accounts.json');

if (!fs.existsSync(ACCOUNTS_FILE)) {
    console.error("Error: config/accounts.json not found.");
    console.error("Please create it first, then run this script to get the string for GitHub Secrets.");
    process.exit(1);
}

const content = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
// Minify it to safe space and avoid newline issues
const minified = JSON.stringify(JSON.parse(content));

console.log("\n=== COPY THE LINE BELOW ===");
console.log(minified);
console.log("===========================\n");
console.log("1. Go to your GitHub Repo -> Settings -> Secrets and variables -> Actions");
console.log("2. Create New Repository Secret");
console.log("3. Name: ACCOUNTS_JSON");
console.log("4. Paste the content above.");
