const fs = require('fs');
const XLSX = require('xlsx');

let rawData;
try {
  rawData = fs.readFileSync('questions.json', 'utf8');
} catch (err) {
  console.error('questions.json not found.');
  process.exit(1);
}

const quizData = JSON.parse(rawData);

function formatForExcel(questions) {
  return questions.map((q, index) => {
    let excelAnswer = '';
    if (q.type === 'choice' || q.type === 'ox') {
      excelAnswer = q.answer !== null ? q.answer + 1 : '';
    } else if (q.type === 'short') {
      excelAnswer = q.correctAnswers ? q.correctAnswers.join(',') : '';
    } else if (q.type === 'essay') {
      excelAnswer = '(manual grading)';
    }
    return {
      '번호': index + 1, '유형': q.type, '문제': q.question,
      '보기1': q.choices && q.choices[0] ? q.choices[0] : '',
      '보기2': q.choices && q.choices[1] ? q.choices[1] : '',
      '보기3': q.choices && q.choices[2] ? q.choices[2] : '',
      '보기4': q.choices && q.choices[3] ? q.choices[3] : '',
      '정답': excelAnswer, '제한시간': q.timeLimit
    };
  });
}

const wb = XLSX.utils.book_new();
const ws1 = XLSX.utils.json_to_sheet(formatForExcel(quizData.main || []));
const ws2 = XLSX.utils.json_to_sheet(formatForExcel(quizData.comeback || []));
XLSX.utils.book_append_sheet(wb, ws1, '문제목록');
XLSX.utils.book_append_sheet(wb, ws2, '패자부활전');
XLSX.writeFile(wb, 'questions.xlsx');
console.log('questions.xlsx created successfully!');
