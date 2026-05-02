const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

const inputPath = path.join(__dirname, 'questions_260420.xlsx');
const workbook = xlsx.readFile(inputPath);
const sheetName = workbook.SheetNames[0];
const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

const oxPool = [];
const choicePool = [];

data.forEach(row => {
  if (row['유형'] === 'ox') oxPool.push(row);
  else if (row['유형'] === 'choice') choicePool.push(row);
});

shuffle(oxPool);
shuffle(choicePool);

// 정규 라운드용: OX 45개, 객관식 25개
const mainOx = oxPool.slice(0, 45);
const mainChoice = choicePool.slice(0, 25);

// 각 라운드(1~5) 마지막 주관식 5개
const shortQuestions = [
  { 유형: 'short', 문제: "태양계에서 가장 큰 화산인 '올림푸스 화산'이 있는 행성의 이름은 무엇인가요?", 정답: "화성", 제한시간: 15 },
  { 유형: 'short', 문제: "별의 일생 중 마지막 단계에서 엄청난 에너지를 방출하며 폭발하는 현상을 무엇이라고 하나요?", 정답: "초신성", 제한시간: 15 },
  { 유형: 'short', 문제: "블랙홀 주변에서 빛조차 빠져나갈 수 없는 경계면을 이르는 용어는 무엇인가요?", 정답: "사건의지평선, 이벤트호라이즌", 제한시간: 15 },
  { 유형: 'short', 문제: "지구에서 가장 가까운 은하로, 우리 은하와 충돌할 것으로 예상되는 은하의 이름은 무엇인가요?", 정답: "안드로메다은하, 안드로메다", 제한시간: 15 },
  { 유형: 'short', 문제: "우주 공간을 떠도는 암석 덩어리가 지구 대기권에 진입하여 빛을 내며 타는 현상을 무엇이라고 하나요?", 정답: "유성, 별똥별", 제한시간: 15 }
];

const finalQuestions = [];
let oxIdx = 0;
let choiceIdx = 0;

// 1~75번 문제 생성 (5회차)
for (let r = 0; r < 5; r++) {
  for(let i=0; i<3; i++) finalQuestions.push(mainOx[oxIdx++]);
  finalQuestions.push(mainChoice[choiceIdx++]);
  for(let i=0; i<3; i++) finalQuestions.push(mainOx[oxIdx++]);
  finalQuestions.push(mainChoice[choiceIdx++]);
  for(let i=0; i<2; i++) finalQuestions.push(mainOx[oxIdx++]);
  finalQuestions.push(mainChoice[choiceIdx++]);
  for(let i=0; i<1; i++) finalQuestions.push(mainOx[oxIdx++]);
  for(let i=0; i<2; i++) finalQuestions.push(mainChoice[choiceIdx++]);
  
  finalQuestions.push(shortQuestions[r]);
}

// 76~99번 골든벨 생성 (6세트 x 4문제 = 24문제)
const gbData = [
  // Set 1
  { type: 'choice', q: "다음 중 허블 법칙(v = Hr)에 대한 설명으로 옳은 것은?", a1: "은하의 후퇴 속도는 지구로부터의 거리에 반비례한다.", a2: "허블 상수의 역수는 우주의 나이와 관련이 깊다.", a3: "모든 은하는 우리 은하를 중심으로 팽창하고 있다.", a4: "가까운 은하일수록 적색 편이량이 크게 나타난다.", ans: 2 },
  { type: 'choice', q: "태양의 스펙트럼에서 관찰되는 수많은 검은 흡수선(프라운호퍼선)의 주된 원인은 무엇인가?", a1: "태양 중심부의 핵융합 반응", a2: "태양 대기(광구 상층부)의 저온 기체", a3: "코로나의 초고온 플라즈마 방출", a4: "태양풍에 포함된 고에너지 입자", ans: 2 },
  { type: 'short', q: "지구의 자전축이 약 23.5도 기울어진 채로 태양 주위를 공전하기 때문에 생기는 가장 뚜렷한 자연 현상은 무엇인가요?", ans: "계절의변화, 계절" },
  { type: 'ox', q: "우주 배경 복사(CMBR)는 빅뱅 이후 약 38만 년이 지나 우주의 온도가 약 3000K로 식었을 때 우주 공간으로 퍼져나간 빛이다.", ans: 1 },

  // Set 2
  { type: 'choice', q: "엘니뇨 현상이 발생했을 때 적도 태평양 동부 해역에서 나타나는 변화로 옳은 것은?", a1: "무역풍이 평년보다 강해진다.", a2: "용승이 강화되어 영양염류가 풍부해진다.", a3: "해수면 온도가 평년보다 높아진다.", a4: "강수량이 감소하여 건조해진다.", ans: 3 },
  { type: 'choice', q: "지진파 중 매질의 입자 진동 방향과 파의 진행 방향이 수직인 파동으로, 액체 상태인 외핵을 통과하지 못하는 파는?", a1: "P파", a2: "S파", a3: "L파", a4: "R파", ans: 2 },
  { type: 'short', q: "태양계 행성 중 밀도가 가장 낮아, 만약 거대한 물웅덩이가 있다면 물에 뜰 수 있다고 알려진 행성은?", ans: "토성" },
  { type: 'ox', q: "별의 표면 온도가 높을수록 최대 에너지를 방출하는 파장의 길이는 길어진다.", ans: 2 },

  // Set 3
  { type: 'choice', q: "온대 저기압이 통과할 때의 날씨 변화로 가장 적절한 것은?", a1: "한랭 전선 통과 후 기온이 상승한다.", a2: "온난 전선 통과 후 소나기성 비가 내린다.", a3: "한랭 전선 통과 전후로 풍향이 남서풍에서 북서풍으로 바뀐다.", a4: "온난 전선 통과 전 기압이 점차 상승한다.", ans: 3 },
  { type: 'choice', q: "해수의 염분에 영향을 미치는 요인 중 표층 염분을 높이는 작용을 하는 것은?", a1: "강수량 증가", a2: "빙하의 해빙", a3: "해수의 결빙", a4: "하천수의 유입", ans: 3 },
  { type: 'short', q: "달이 태양과 지구 사이에 위치하여 태양을 완전히 가리는 천문 현상을 무엇이라고 하나요?", ans: "개기일식, 일식" },
  { type: 'ox', q: "빛이 진공 속에서 1년 동안 이동하는 거리를 나타내는 천문학의 거리 단위는 '광년(Light-Year)'이다.", ans: 1 },

  // Set 4
  { type: 'choice', q: "외계 행성계 탐사 방법 중 '도플러 효과(시선 속도 변화)'를 이용하는 방법에 대한 설명으로 옳은 것은?", a1: "행성의 반지름이 클수록 관측이 쉽다.", a2: "행성의 질량이 클수록 중심별의 시선 속도 변화폭이 크다.", a3: "행성이 별의 앞면을 지날 때 별빛이 어두워지는 원리이다.", a4: "행성의 공전 궤도면이 관측자의 시선 방향과 수직일 때 유리하다.", ans: 2 },
  { type: 'choice', q: "판 구조론에서 해양 지각이 새롭게 생성되는 발산형 경계인 해령(Mid-ocean ridge)에 대한 설명으로 옳은 것은?", a1: "판이 소멸하는 보존형 경계이다.", a2: "천발 지진과 심발 지진이 모두 활발히 발생한다.", a3: "해령에서 멀어질수록 해양 지각의 연령이 증가한다.", a4: "주로 화강암질 마그마가 분출된다.", ans: 3 },
  { type: 'short', q: "지구 표면의 약 70%를 차지하며, 엄청난 양의 태양열을 저장하고 기후를 조절하는 거대한 소금물 덩어리를 무엇이라고 하나요?", ans: "바다, 해양" },
  { type: 'ox', q: "주계열성은 중심부에서 수소 핵융합 반응이 일어나는 별을 말하며, 질량이 클수록 주계열성에 머무는 수명은 길다.", ans: 2 },

  // Set 5
  { type: 'choice', q: "대기 대순환에서 적도 지방에서 가열되어 상승한 공기가 위도 30도 부근에서 하강하여 형성하는 직접 순환 세포는?", a1: "해들리 순환", a2: "페렐 순환", a3: "극 순환", a4: "워커 순환", ans: 1 },
  { type: 'choice', q: "암흑 물질(Dark Matter)과 암흑 에너지(Dark Energy)에 대한 설명으로 옳은 것은?", a1: "암흑 물질은 전자기파로 직접 관측할 수 있다.", a2: "우주의 가속 팽창을 설명하기 위해 도입된 개념이 암흑 에너지이다.", a3: "현재 우주를 구성하는 요소 중 가장 큰 비율을 차지하는 것은 보통 물질이다.", a4: "암흑 물질은 중력적 상호작용을 하지 않는다.", ans: 2 },
  { type: 'short', q: "밤하늘에서 길을 찾을 때 나침반 역할을 하며, 지구 자전축의 연장선 근처에 있어 항상 북쪽을 가리키는 별의 이름은 무엇인가요?", ans: "북극성" },
  { type: 'ox', q: "지질 시대 중 고생대에는 공룡과 암모나이트가 번성하였다.", ans: 2 },

  // Set 6
  { type: 'choice', q: "H-R도(헤르츠스프룽-러셀도)에서 별의 표면 온도와 광도에 따른 분류 중, 백색 왜성의 위치는 어디인가?", a1: "왼쪽 위 (고온 고광도)", a2: "오른쪽 위 (저온 고광도)", a3: "왼쪽 아래 (고온 저광도)", a4: "오른쪽 아래 (저온 저광도)", ans: 3 },
  { type: 'choice', q: "온실 기체 중 전체적인 배출량이 가장 많아 지구 온난화에 가장 큰 기여를 하는 기체는?", a1: "메테인(CH4)", a2: "프레온 가스(CFCs)", a3: "이산화탄소(CO2)", a4: "아산화질소(N2O)", ans: 3 },
  { type: 'short', q: "1969년 아폴로 11호를 타고 인류 최초로 달 표면에 발을 내디딘 우주비행사의 이름은?", ans: "닐암스트롱, 암스트롱" },
  { type: 'ox', q: "엘니뇨-남방진동(ENSO) 현상에서, 동태평양 해면 기압이 평년보다 높아지고 서태평양 기압이 낮아져 무역풍이 강화될 때는 라니냐 시기이다.", ans: 1 },
];

gbData.forEach(g => {
  const row = { 유형: g.type, 문제: g.q, 제한시간: 15 };
  if (g.type === 'choice') {
    row['보기1'] = g.a1; row['보기2'] = g.a2; row['보기3'] = g.a3; row['보기4'] = g.a4;
  }
  row['정답'] = g.ans;
  finalQuestions.push(row);
});

// 100번 문제: 보스 문제 (정답: 31)
finalQuestions.push({
  유형: 'short',
  문제: "[최종 보스 문제] 프랑스의 천문학자 샤를 메시에가 작성한 성단과 성운 목록(메시에 목록)에서, M1(게 성운)은 1054년에 관측된 초신성 잔해입니다. 그렇다면 우리 은하에서 가장 가까운 대형 나선 은하인 '안드로메다 은하'의 메시에 목록 번호는 M 몇 번일까요? (숫자만 입력)",
  정답: "31",
  제한시간: 20
});

finalQuestions.forEach((q, idx) => {
  q['번호'] = idx + 1;
});

const header = ['번호', '유형', '문제', '보기1', '보기2', '보기3', '보기4', '정답', '제한시간'];
const ws = xlsx.utils.json_to_sheet(finalQuestions, { header });
const newWb = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(newWb, ws, "Sheet1");

const outputPath = path.join(__dirname, 'question_260502_v2.xlsx');
xlsx.writeFile(newWb, outputPath);
console.log('Successfully generated ' + outputPath);
