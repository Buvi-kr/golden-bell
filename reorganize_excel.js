const xlsx = require('xlsx');
const fs = require('fs');

// 1. 기존 파일 로드
const wb = xlsx.readFile('questions.xlsx');
const sheet = wb.Sheets[wb.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet);

// 안전을 위해 백업 파일 저장
if (!fs.existsSync('questions_backup.xlsx')) {
  fs.copyFileSync('questions.xlsx', 'questions_backup.xlsx');
  console.log('✅ 원본 백업 완료 (questions_backup.xlsx)');
}

// 2. 분리
const speedQ = data.slice(0, 75); // 1~75번
const gbQ = data.slice(75, 100);  // 76~100번

// 3. 병합 (15개 + 5개) x 5회차
const newData = [];
for (let i = 0; i < 5; i++) {
  const s = speedQ.slice(i * 15, i * 15 + 15);
  const g = gbQ.slice(i * 5, i * 5 + 5);
  newData.push(...s, ...g);
}

// 4. 번호 재부여
newData.forEach((row, idx) => {
  if (row['번호']) row['번호'] = idx + 1;
  if (row['id']) row['id'] = idx + 1;
});

// 5. 새 파일로 덮어쓰기
const newSheet = xlsx.utils.json_to_sheet(newData);
const newWb = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(newWb, newSheet, wb.SheetNames[0]);
xlsx.writeFile(newWb, 'questions.xlsx');

console.log('✅ 엑셀 파일 개편 완료 (총 ' + newData.length + '문제)');
