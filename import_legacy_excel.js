const fs = require('fs');
const xlsx = require('xlsx');

const ACCOUNTS_FILE = 'config/accounts.json';
const FILES = [
    '50 App Password Gmails - (8-2-26).xlsx',
    '50 old mails app password SMTP.xlsx'
];

let existingAccs = [];
try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
        console.log(`Loading accounts from ${ACCOUNTS_FILE}...`);
        const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
        try {
            existingAccs = JSON.parse(raw);
            console.log(`Loaded ${existingAccs.length} existing accounts.`);
        } catch (parseErr) {
            console.error("JSON Parse Error:", parseErr.message);
            // Backup corrupt file?
            fs.writeFileSync(ACCOUNTS_FILE + '.bak', raw);
            console.log("Backed up corrupt file to .bak");
        }
    } else {
        console.log("Accounts file not found, starting fresh.");
    }
} catch (e) {
    console.error("Error reading accounts file", e);
}

const accMap = new Map();
existingAccs.forEach(a => {
    if (a.username) accMap.set(a.username.toLowerCase(), a);
});

let importedCount = 0;

FILES.forEach(file => {
    if (!fs.existsSync(file)) {
        console.warn(`File not found: ${file}`);
        return;
    }
    console.log(`Reading ${file}...`);
    try {
        const wb = xlsx.readFile(file);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = xlsx.utils.sheet_to_json(ws, { header: 1 }); // Array of arrays

        data.forEach((row, idx) => {
            if (idx === 0) return; // Skip header

            // Filter empty cells
            const cells = row.filter(c => c);

            // Heuristic
            const email = cells.find(c => String(c).includes('@') && String(c).length > 5);
            const pass = cells.find(c => c !== email && String(c).length > 6);

            if (email && pass) {
                const username = String(email).trim();
                const password = String(pass).trim();

                let type = 'gmail';
                if (username.includes('outlook') || username.includes('hotmail')) type = 'microsoft';

                const newAcc = {
                    type,
                    username,
                    password,
                };

                if (!accMap.has(username.toLowerCase())) {
                    accMap.set(username.toLowerCase(), newAcc);
                    importedCount++;
                } else {
                    // Update existing
                    accMap.set(username.toLowerCase(), { ...accMap.get(username.toLowerCase()), ...newAcc });
                    // importedCount++? No, updated.
                }
            }
        });
    } catch (e) {
        console.error(`Error processing ${file}:`, e);
    }
});

const finalAccounts = Array.from(accMap.values());
fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(finalAccounts, null, 2));

console.log(`Import Complete.`);
console.log(`New Accounts Added: ${importedCount}`);
console.log(`Total Accounts Now: ${finalAccounts.length}`);

const counts = {};
finalAccounts.forEach(a => { counts[a.type] = (counts[a.type] || 0) + 1; });
console.log('Breakdown:', counts);
