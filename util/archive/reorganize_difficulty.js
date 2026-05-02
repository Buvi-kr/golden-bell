const XLSX = require('xlsx');

/**
 * 1-5 Difficulty Mapping (As requested, based on the first version)
 */
const DIFFICULTY_MAP = {
  // Level 0: Absolute Basics
  "지구는 평평하다.": 0, "지구는 둥글다.": 0,

  // Level 1: Very Basic
  "진공 상태인 우주에서는 소리를 들을 수 없다.": 1, "진공 상태인 우주에서 소리를 들을 수 있다.": 1,
  "달은 스스로 빛을 낼 수가 있다.": 1, "달은 스스로 빛을 낼 수 없다.": 1,
  "태양은 태양계의 유일한 별이다.": 1, 
  "태양계는 '우리은하'에 속해 있다.": 1, "북두칠성의 '북두'는 국자라는 의미이다.": 1,
  "지구에서 가장 가까운 은하로, 우리 은하와 충돌할 것으로 예상되는 은하의 이름은 무엇인가요?": 1,
  "블랙홀은 너무 커다란 중력때문에 빛도 흡수한다.": 1, "별을 관찰할 때 쓰는 도구는?": 1,
  "빛이 1년동안 이동하는 거리를 '광년'이라고 한다.": 1, "밤하늘에서 가장 밝게 빛나는 '달'은 지구의 무엇인가요?": 1,
  "지구의 내부 구조가 아닌 것은?": 1, "태양의 표면에서 주변보다 온도가 낮아 어둡게 보이는 부분의 이름은?": 1,
  "황도 12궁에 포함된 별자리는?": 1, "우주가 한 점으로 탄생하고 팽창해 지금의 우주가 되었다는 이론은?": 1,
  "지구와 크기가 비슷한 태양계 행성은?": 1, "태양계 중 지구형 행성이 아닌 행성은?": 1,
  "태양계 중 기체 행성이 아닌 것은?": 1, "행성을 중심으로 위성이 일정궤도를 따라 주변을 도는 것을 '공전'이라고 한다.": 1,
  "일식은 태양이 달을 가리는 현상이다.": 1, "우주 공간을 떠도는 암석 덩어리가 지구 대기권에 진입하여 빛을 내며 타는 현상을 무엇이라고 하나요?": 1,
  "지구에서 가장 가까운 은하로": 1,

  // Level 2: Basic Astronomy
  "토성의 고리는 대부분 물, 얼음으로 이루어져있다.": 2,
  "달은 자전주기와 공전주기가 똑같다.": 2, "은하의 모양 중 없는 모양은?": 2,
  "별은 온도가 낮을 수록 파랗다.": 2, "별의 온도가 높을 수록 파랗다.": 2,
  "태양과 비슷한 질량의 별들이 진화 끝에 온도가 낮고 밀도가 높은 상태를 '백색왜성'이라고 한다.": 2,
  "태양계 행성 중 자전축이 옆으로 누워있어 옆으로 굴러가 듯 자전하는 행성은?": 2,
  "태양계에서 가장 큰 화산인 '올림푸스 화산'이 있는 행성의 이름은 무엇인가요?": 2,
  "고리를 가진 행성은 토성뿐이다.": 2, "명왕성의 새 이름은 '왜소행성134340'이다.": 2,
  "별이 탄생하는 가스와 먼지의 구름을 무엇이라 하나요?": 2,
  "별의 일생 중 마지막 단계에서 엄청난 에너지를 방출하며 폭발하는 현상을 무엇이라고 하나요?": 2,
  "금성은 다른 행성들의 반대 방향으로 자전한다.": 2, "금성은 다른 행성과 같은 방향으로 자전한다.": 2,
  "화성의 대기는 대부분 이산화탄소로 이루어져있다.": 2, "크레이터는 달에만 있고 다른 행성이나 위성에는 없다.": 2,
  "달 탐사에 사용된 차의 이름은 '월면차'이다.": 2, "1등성은 6등성보다 100배 밝다.": 2,
  "별의 수명 마지막 단계에서 일으키는 폭발의 이름은?": 2, "화성의 노을은 붉은 색이다.": 2, "화성의 노을은 푸른 색이다.": 2,
  "태양의 표면 온도는 약 6,000도(C)이다.": 2, "달의 '바다'에는 물이 있다.": 2, "태양계에서 가장 큰 위성은?": 2,

  // Level 3: Intermediate
  "별 등급 중 1등성은 6등성의 밝기보다 99배 밝다.": 3, "태양계에서 가장 빠른 바람이 부는 행성은?": 3,
  "보현산천문대는 한국에서 제일 큰 망원경을 가지고 있는 천문대이다.": 3, "황도 12궁에는 뱀주인자리가 포함된다.": 3,
  "해왕성에서 부는 바람은 태양계 행성 중 제일 느리다.": 3, "이소연 우주인이 탄 우주선의 이름은?": 3,
  "금성은 공전 속도보다 자전 속도가 빨라 하루가 1년보다 짧다.": 3, "우주에 가본 적 없는 생물은?": 3,
  "카이퍼 벨트는 주기가 짧은 단주기 혜성의 고향이다.": 3, "질량이 큰 별이 진화 끝에 초신성 폭발을 겪고 남겨진 중심핵을 뭐라고 부르나요?": 3,
  "태양은 지구의 약 109배 크다.": 3, "외부은하의 후퇴속도는 거리에 비례한다'라는 법칙의 이름은?": 3,
  "수십만에서 수백만개의 늙은 별들이 공 모양으로 빽빽하게 모여있는 별의 집단 이름을 구상성단이라고 부른다.": 3,
  "인류 최초의 우주인은 누구인가요?": 3, "현대 88개 별자리 중 황도 12궁에 속하지 않는 별자리는?": 3,
  "달 탐사에 가진 않은 사람은?": 3,

  // Level 4-5: Advanced / History
  "이소연 우주인은 전세계에서 475번째": 4, "국제우주정거장은 하루에 지구를 약 15.7바퀴": 4,
  "지구와 달 사이에는 모든 태양계 행성이 들어갈 수 있다.": 4, "지구와 달 사이의 거리는 태양계 모든 행성": 4,
  "천상열차분야지도": 4, "사건의 지평선": 5, "이벤트호라이즌": 5, "경계면": 5,
  "세종 때 편찬된 역법서인 '칠정산'에는 천왕성도 있다.": 5, "초파리는 최초로 우주선에 탄 생명체가 아니다.": 4,
  "조선시대에 편찬된 역법인 칠정산에 해당되지 않는 것은?": 5, "조선 초기에 제작된 별자리지도의 이름은?": 4,
  "망원경의 역사에 없는 방식은?": 4
};

function getDifficulty(q) {
  const text = (q || "").toString().trim();
  for (let key in DIFFICULTY_MAP) {
    if (text.includes(key) || key.includes(text)) return DIFFICULTY_MAP[key];
  }
  return 3; 
}

const HEADERS = ['번호', '유형', '문제', '보기1', '보기2', '보기3', '보기4', '정답', '제한시간'];

function formatRow(r, newNum) {
  const row = {};
  HEADERS.forEach(h => {
    row[h] = r[h] !== undefined ? r[h] : "";
  });
  row['번호'] = newNum;
  return row;
}

const wb = XLSX.readFile('questions_260502.xlsx');
const sheet = wb.Sheets[wb.SheetNames[0]];
const allRows = XLSX.utils.sheet_to_json(sheet);

const mainRows = allRows.slice(0, 75);
const goldenRows = allRows.slice(75);

// 1. Group by type and sort globally
const pools = { ox: [], choice: [], short: [] };
mainRows.forEach(r => {
  const type = (r['유형'] || 'choice').toLowerCase().trim();
  pools[type].push({ data: r, diff: getDifficulty(r['문제']) });
});
Object.values(pools).forEach(pool => pool.sort((a, b) => a.diff - b.diff));

// 2. Fixed Type Template
const ROUND_TEMPLATE = [
  'ox', 'ox', 'ox', 'choice', 
  'ox', 'ox', 'ox', 'choice',
  'ox', 'ox', 'choice',
  'ox', 'choice', 'choice', 
  'short'
];

const finalMain = [];
for (let r = 0; r < 5; r++) {
  const typesNeeded = ROUND_TEMPLATE.reduce((acc, t) => {
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  const roundPools = {
    ox: pools.ox.splice(0, typesNeeded.ox),
    choice: pools.choice.splice(0, typesNeeded.choice),
    short: pools.short.splice(0, typesNeeded.short)
  };

  // Inside the round, easy first, hard last
  roundPools.ox.sort((a,b) => a.diff - b.diff);
  roundPools.choice.sort((a,b) => a.diff - b.diff);

  ROUND_TEMPLATE.forEach(type => {
    const item = roundPools[type].shift();
    finalMain.push(formatRow(item.data, finalMain.length + 1));
  });
}

const finalRows = finalMain.concat(goldenRows.map((r, i) => formatRow(r, 76 + i)));

const newSheet = XLSX.utils.json_to_sheet(finalRows, { header: HEADERS });
const newWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(newWb, newSheet, 'Questions');
XLSX.writeFile(newWb, 'questions.xlsx');

console.log('✅ RE-ORGANIZED: Using original 1-5 difficulty map from questions_260502.xlsx.');
console.log('✅ 5 Rounds of 15 questions, each with a difficulty ramp.');
console.log('✅ OX/Choice pattern and cell alignment fixed.');
