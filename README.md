# MyStockOverlay

**MyStockOverlay**는 백엔드 없이 작동하는 '항상 위(Always on top)', '클릭 패스쓰루(Click-through)' 기능의 투명 실시간 주가 티커 앱입니다.

## 🎯 프로젝트 구조화 목표 및 아키텍처
MyStockOverlay는 무거운 백엔드 대신 클라이언트가 직접 증권사 API와 통신하는 엣지 중심(Edge-centric) 아키텍처를 지향합니다. 메인 컨트롤 패널과 각 주식 종목의 티커 위젯이 독립적인 윈도우로 동작하며, Tauri 백엔드를 통해 시스템 자원(항상 위, 단축키 등)에 접근합니다.

```text
+-------------------------------------------------------+
|                 MyStockOverlay App                    |
|                                                       |
|  +----------------+        +-----------------------+  |
|  | Control Panel  |<------>| Tauri Core (Rust)     |  |
|  | (React/Vite)   | State  | - Global Shortcuts    |  |
|  +----------------+        | - Window Management   |  |
|         |                  | - System Tray         |  |
|         v                  +-----------------------+  |
|  +----------------+                   |               |
|  | Ticker Widget  |                   |               |
|  | (React/Vite)   |<------------------+               |
|  +----------------+                                   |
|         |                                             |
+---------|---------------------------------------------+
          |
    +-----v-----+
    | WebSocket | (KIS API / Yahoo Finance 등)          |
    +-----------+                                       |
```

## 📚 문서 파일 색인
- **[README.md](./README.md)**: 프로젝트 개요, 구조도, 실행 및 빌드 방법 안내
- **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)**: 코드 기준 시스템 구조, 데이터 흐름, Tauri 이벤트/명령 정리
- **[docs/FRONTEND_ARCHITECTURE.md](./docs/FRONTEND_ARCHITECTURE.md)**: 화면 구조, 훅, 저장소, 컴포넌트 정리
- **[docs/DATA_ARCHITECTURE.md](./docs/DATA_ARCHITECTURE.md)**: KIS, Yahoo, Tauri 브리지, 토스 OpenAPI 참고 정리
- **[docs/PROVIDER_DESIGN.md](./docs/PROVIDER_DESIGN.md)**: 시세 provider 인터페이스, 모드 전환, 폴백 규칙 정리
- **[TASK.md](./TASK.md)**: 모듈 단위 작업 내역(완료/예정 목록) 관리
- **[DEVNOTES.md](./DEVNOTES.md)**: 개발 중 발생한 핵심 오류 및 트러블슈팅 노하우 기록

## 🎯 프로젝트 목표
- **가벼움**: 무거운 백엔드나 불필요한 기능 없이 오직 현재가 확인에만 집중한 초경량 설계.
- **방해 없는 오버레이**: 투명한 배경과 마우스 클릭 패스쓰루를 지원하여, 게임이나 다른 작업 화면 위에 띄워두고 방해 없이 주가를 모니터링할 수 있습니다.
- **다중 창(멀티 윈도우) 지원**: 메인 컨트롤 패널과 각 종목별 독립된 티커 창 구조를 분리하여 원하는 곳에 자유롭게 배치할 수 있습니다.
- **한국투자증권(KIS) 실시간 API 적용**: 폴링(Polling) 방식의 딜레이가 아닌, 웹소켓(Websocket)을 사용한 완전 실시간 체결가 데이터를 수신합니다.

## ✨ 핵심 기능
1. **투명 배경 및 타이틀바 제거**: 화면 공간을 낭비하지 않는 미니멀한 Ticker UI.
2. **항상 위 보이기 (Always on top)**: 어떤 상황에서도 최상단 창에 고정.
3. **마우스 패스쓰루 및 단축키 토글**: 평소에는 마우스 클릭 이벤트를 무시하며, 전역 단축키(`Ctrl+Shift+L`)로 언제든 드래그 모드를 토글할 수 있습니다.
4. **전역 스케일(Scale) 조절**: 제어판 슬라이더를 통해 모든 티커의 글자 및 전체 크기를 0.5배~2.0배까지 실시간으로 조절할 수 있습니다.
5. **빠른 상세 페이지 오픈**: 드래그 모드 상태에서 티커 종목을 더블 클릭하면 자동으로 네이버 금융 상세 페이지를 열어줍니다.
6. **업종 지수 지원**: 코스피, 코스닥 등 지수 데이터를 스마트하게 식별하여 구독 및 파싱합니다.
7. **미니 차트(Sparkline) 제공**: 전일 장외부터 당일 프리/정규/애프터마켓까지 아우르는 12시간 이상의 시세 흐름을 부드러운 하단 미니 차트로 제공합니다.
8. **커스터마이징 UI**: 폰트, 크기, 상승/하락 텍스트 컬러 등을 쉽게 수정할 수 있는 CSS 변수 구조 적용.

## 🛠 기술 스택

### 🏗️ Core Framework & Language
*   **Tauri v2 (Rust)**: 앱의 전체 구조와 시스템 제어(창 생성, 전역 단축키 수신, 항상 위 설정, 마우스 이벤트 제어 등)를 담당하는 백엔드 프레임워크입니다.
*   **React 19**: 사용자 인터페이스를 구축하기 위한 프론트엔드 라이브러리입니다.
*   **TypeScript**: 코드의 안정성과 가독성을 높이기 위해 프론트/백엔드 모두에서 사용 중인 주력 언어입니다.

### 🎨 Styling & UI
*   **Tailwind CSS v4**: 유틸리티 우선(Utility-first) 방식의 최신 스타일링 프레임워크로, 미니멀하고 세련된 다크 모드 UI를 구현했습니다.
*   **Lucide React**: 티커와 컨트롤 패널에 사용된 깔끔한 벡터 아이콘 세트입니다.
*   **Glassmorphism**: 투명 배경과 `backdrop-blur` 효과를 이용해 배경 유리에 비치는 듯한 프리미엄 디자인을 적용했습니다.

### 🛠️ Frontend Ecosystem
*   **Vite**: 초고속 빌드 및 개발 환경 구성을 위한 빌드 도구입니다.
*   **React Router DOM v7**: 메인 설정창(`ControlPanel`)과 개별 주식 티커(`TickerWidget`)를 경로별로 나누어 독립된 창으로 띄우기 위해 사용했습니다.

### 🔌 Tauri Plugins (핵심 기능 보조)
*   **tauri-plugin-global-shortcut**: `Ctrl+Shift+L` 전역 단축키를 감지하여 마우스 패스쓰루를 켜고 끕니다.
*   **tauri-plugin-window-state**: 티커 창들의 위치와 크기를 자동으로 기억하고 다음 실행 시 복원합니다.
*   **tauri-plugin-opener**: 티커 더블 클릭 시 시스템 기본 브라우저로 네이버 금융 상세 페이지를 엽니다.

### 📊 Data & API (Multi-Source Strategy)
*   **국내 주식/지수**: 한국투자증권(KIS) OpenAPI 활용 (실시간/모의투자)
    *   전일 종가(기준가)는 API 제공 필드(`stck_sdpr`, `bstp_nmix_prdy_clpr`)를 직접 사용하도록 단순화됨
    *   **듀얼 모드 지원**: 보안을 위한 '모의투자(Virtual)'와 '실전투자(Real)' 계좌를 모두 지원하며, 설정 창에서 즉시 전환 가능합니다.
    *   **REST API**: 초기 데이터 로드 및 지수 조회용.
    *   **WebSocket**: 실시간 체결가 수신용 (단일 소켓 아키텍처).
*   **폴백**: Yahoo Finance API 활용 (KIS API 장애 또는 미지원 시)
    *   Yahoo의 `chartPreviousClose` 및 `previousClose` 필드를 기준가로 사용
    *   **안정적인 폴백**: KIS API 장애 시 또는 해외 주식 조회를 위해 1분 주기로 백업 데이터를 제공합니다.
    *   **무인증**: 별도의 키 설정 없이도 즉시 작동하는 비상용 소스입니다.

## 🚀 사용 가이드
1.  앱 실행 후 제어판(ControlPanel)에서 본인의 KIS AppKey와 AppSecret을 입력합니다.
2.  배포나 테스트를 원할 경우 **VIRTUAL** 모드를 선택하고 모의투자 키를 사용하세요.
3.  종목 코드를 추가하고 '전체 띄우기'를 누르면 투명한 티커 창이 생성됩니다.
4.  `Ctrl+Shift+L` 단축키로 티커를 잠금/해제하여 원하는 위치에 배치하세요.

## 💻 실행 및 빌드 방법 (How to Run & Build)

### 사전 요구사항 (Prerequisites)
- [Node.js](https://nodejs.org/) (v18 이상 권장)
- [Rust & Cargo](https://rustup.rs/) (Tauri 백엔드 빌드용)
- 데스크톱 플랫폼별 빌드 도구 (Windows: Visual Studio C++ Build Tools 등)

### 1. 패키지 설치
프로젝트 폴더에서 필요한 npm 의존성을 설치합니다.
```bash
npm install
```

### 2. 개발 모드 실행 (Run)
개발 서버를 띄우고 Tauri 앱을 실행합니다. 코드 변경 시 자동으로 핫 리로드(HMR)가 적용됩니다.
```bash
npm run tauri dev
```

### 3. 배포용 빌드 (Build)
설치 가능한 독립 실행 파일(.exe, .dmg 등 OS에 맞는 형식)을 생성합니다. 
성공적으로 빌드가 완료되면 결과물은 `src-tauri/target/release/bundle` 폴더 내에 생성됩니다.
```bash
npm run tauri build
```
