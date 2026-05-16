import pkg from 'xlsx';
const { readFile, utils } = pkg;

async function extractFullSheet() {
    try {
        const workbook = readFile('Production Form Plan.xlsx');
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON with all columns
        const data = utils.sheet_to_json(worksheet, { header: 1 });
        
        console.log('--- FULL SHEET DATA ---');
        data.slice(0, 100).forEach((row: any, idx: number) => {
            console.log(`Row ${idx}:`, JSON.stringify(row));
        });
        console.log('--- END ---');
    } catch (err) {
        console.error('Error reading excel:', err);
    }
}

extractFullSheet();
