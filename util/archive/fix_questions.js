const xlsx = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, 'questions.xlsx');
const workbook = xlsx.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

data.forEach((row, i) => {
  // OX 유형인데 보기가 없는 경우 채워줌
  if (row['유형'] === 'ox') {
    if (!row['보기1']) row['보기1'] = 'O';
    if (!row['보기2']) row['보기2'] = 'X';
  }
  
  // 제한시간이 없는 경우 기본값 15초
  if (!row['제한시간']) row['제한시간'] = 15;
});

const header = ['번호', '유형', '문제', '보기1', '보기2', '보기3', '보기4', '정답', '제한시간'];
const ws = xlsx.utils.json_to_sheet(data, { header });
const newWb = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(newWb, ws, "Sheet1");

xlsx.writeFile(newWb, filePath);
console.log('Successfully fixed questions.xlsx');
