const xlsx = require('xlsx');
const wb = xlsx.readFile('questions.xlsx');
const sheet = wb.Sheets[wb.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet);
console.log(`Total questions: ${data.length}`);
console.log("First 5 questions:");
console.dir(data.slice(0, 5));
console.log("Questions from 70 to 80:");
console.dir(data.slice(70, 80));
