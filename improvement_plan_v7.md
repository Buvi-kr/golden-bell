# ⚡ Speed Golden Bell v7.2 — UI/UX 개편 계획 (Ultra-Wide 3단 레이아웃)

본 문서는 `display.html`의 3840x1080 (가로세로 비율 2:1 이상) 해상도 환경을 위한 UI 대규모 개편 계획입니다.
해당 변경사항은 현재 `display_test.html`에 구현 및 검증되어 있으며, 추후 원본 `display.html`에 적용될 예정입니다.

## 🎯 개편 목표
울트라와이드 디스플레이의 넓은 가로 공간을 효율적으로 사용하기 위해 2단(35:65) 레이아웃에서 **3단(35:40:25)** 레이아웃으로 전환하고, 시각적 몰입도와 가독성을 극대화합니다.

---

## 🛠 주요 개편 사항 (적용 가이드)

### 1. 3단 분할 그리드 구조 도입
기존 2단(좌측 문제, 우측 보기) 구조에서, 우측의 잉여 공간을 분리하여 3단으로 구성합니다.
*   **좌측 (35%)**: 기존 타이머, 문제 번호, 문제 텍스트 영역
*   **중앙 (40%)**: 객관식 보기 카드 및 **누적 막대그래프(Chart.js) 상시 렌더링**
*   **우측 (25%)**: 상품 안내 패널 상시 노출 영역

**[수정할 CSS]**
```css
#sQuestion {
  grid-template-columns: 35% 40% 25%;
  grid-template-areas:
    "timer  banner   prize"
    "qbox   choices  prize"
    "qbox   choices  prize";
}
```

### 2. '상품 안내 패널' 우측 상시 고정
기존 우측에 간헐적으로 뜨던 텍스트 통계 패널(`statsPanel`)을 완전히 숨기고, 그 자리에 초대형 상품 안내를 박아두어 참가자들의 동기를 자극합니다.

**[적용 방법]**
1. 기존 CSS의 `#statsPanel` 숨김 처리:
   `#statsPanel { display: none !important; }`
2. `contentArea` 태그 바로 아래에 상품 HTML 태그 추가:
```html
<div class="lobby-prize-card" id="qPrizePanel" style="grid-area: prize; display:flex; flex-direction:column; justify-content:center; ...">
  <div class="prize-title">🎁 상품 안내</div>
  <div class="prize-line">🏆 <strong>최종 우승 (골든벨)</strong> 특별 상품!</div>
  <div class="prize-line">🎉 <strong>20등 이내 생존자</strong> 소정의 상품</div>
</div>
```

### 3. 상단 헤더(생존자/탈락자) 시인성 극대화
뒷자리 참가자들도 현재 생존자 수를 명확하게 볼 수 있도록 상단 정보창을 파격적으로 키웁니다.
*   **배치**: 양옆으로 퍼져있던 레이아웃을 정중앙으로 밀집 (`gap: 2vw`)
*   **크기**: 숫자 폰트를 기존 `7.5vh`에서 무려 **`15vh`로 2배 확대**

**[수정할 CSS]**
```css
header { height: 25vh; }
.hstats { gap: 2vw; }
.hnum { font-size: 15vh !important; }
.hstat { padding: 2vh 5vh; min-width: 30vh; }
```

### 4. 로비 QR 코드 스타일 복구
QR 코드 배경의 흰색 패딩, 둥근 테두리, 모서리 장식(`qc`), 그림자를 모두 제거하여 QR 이미지 자체만 깔끔하게 노출합니다.

**[수정할 CSS]**
```css
.qr-card { padding: 0 !important; background: transparent !important; box-shadow: none !important; border: none !important; }
```

---

## 🚀 향후 작업 (Next Step)
본 개편안(v7.2)을 라이브 서버에 적용할 경우, 위 4가지 CSS/HTML 변경점만 `public/display.html`의 `@media (min-aspect-ratio: 2/1)` 블록 내부에 붙여넣기 하면 기존 로직 훼손 없이 즉시 100% 호환 적용됩니다.
