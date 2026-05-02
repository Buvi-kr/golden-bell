const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));

files.forEach(fileName => {
  const filePath = path.join(__dirname, fileName);
  try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    let modified = false;
    data.forEach((row) => {
      if (row['유형'] === 'ox') {
        if (!row['보기1']) { row['보기1'] = 'O'; modified = true; }
        if (!row['보기2']) { row['보기2'] = 'X'; modified = true; }
      }
      if (!row['제한시간']) { row['제한시간'] = 15; modified = true; }
    });

    if (modified) {
      const header = ['번호', '유형', '문제', '보기1', '보기2', '보기3', '보기4', '정답', '제한시간'];
      const ws = xlsx.utils.json_to_sheet(data, { header });
      const newWb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(newWb, ws, "Sheet1");
      xlsx.writeFile(newWb, filePath);
      console.log(`Fixed ${fileName}`);
    }
  } catch (e) {
    console.error(`Failed to process ${fileName}: ${e.message}`);
  }
});
