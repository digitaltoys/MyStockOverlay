# MyStockOverlay

**MyStockOverlay**는 백엔드 없이 작동하는 '항상 위(Always on top)', '클릭 패스쓰루(Click-through)' 기능의 투명 실시간 주가 티커 앱입니다.

## 🎯 프로젝트 목표
- **가벼움**: 무거운 백엔드나 불필요한 기능 없이 오직 현재가 확인에만 집중한 초경량 설계.
- **방해 없는 오버레이**: 투명한 배경과 마우스 클릭 패스쓰루를 지원하여, 게임이나 다른 작업 화면 위에 띄워두고 방해 없이 주가를 모니터링할 수 있습니다.
- **다중 창(멀티 윈도우) 지원**: 메인 컨트롤 패널과 각 종목별 독립된 티커 창 구조를 분리하여 원하는 곳에 자유롭게 배치할 수 있습니다.
- **한국투자증권(KIS) 실시간 API 적용**: 폴링(Polling) 방식의 딜레이가 아닌, 웹소켓(Websocket)을 사용한 완전 실시간 체결가 데이터를 수신합니다.

## ✨ 핵심 기능
1. **투명 배경 및 타이틀바 제거**: 화면 공간을 낭비하지 않는 미니멀한 Ticker UI.
2. **항상 위 보이기 (Always on top)**: 어떤 상황에서도 최상단 창에 고정.
3. **마우스 패스쓰루 (Click-through)**: 티커 영역을 클릭해도 이벤트가 무시되고 밑에 있는 윈도우가 클릭됩니다. 
4. **커스터마이징 UI**: 폰트, 크기, 상승/하락 텍스트 컬러 등을 쉽게 수정할 수 있는 CSS 변수 구조 적용.

## 🛠 기술 스택
- **Framework**: Tauri 2 (Rust 기반 플랫폼)
- **Frontend**: React 19 + TypeScript + Vite
- **Styling**: Tailwind CSS v4 + Lucide React (아이콘)
- **Data Fetching / API**: 한국투자증권(Korea Investment & Securities) 오픈 API (REST & WebSocket)
- **Router**: React Router DOM (메인 설정 화면과 티커 창 분할)
