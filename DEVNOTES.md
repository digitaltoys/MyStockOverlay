# MyStockOverlay 개발 노하우 정리

이 문서는 프로젝트를 진행하면서 겪은 문제들과 해결책을 정리한 기록입니다.

---

## 1. Tauri v2 — 윈도우 투명화 및 깜빡임 방지

### 문제
투명 창(`transparent: true`)에서 React가 마운트되기 전 잠깐 흰 화면이 보임.

### 해결
`src/main.tsx`에서 React가 마운트되기 **전에** 동기적으로 CSS 클래스를 추가.

```tsx
// React 마운트 전 동기 실행
if (window.location.pathname.startsWith("/ticker")) {
  document.documentElement.classList.add("transparent-ticker");
}

ReactDOM.createRoot(...).render(<App />);
```

```css
html.transparent-ticker,
html.transparent-ticker body {
  background-color: transparent !important;
  overflow: hidden;
  min-width: 0 !important;
}
```

---

## 2. Tauri v2 — 창 간 이벤트 전달 (cross-window emit)

### 문제
프론트엔드의 `emit()` (`@tauri-apps/api/event`)은 **동일한 WebView 창 내에서만** 동작한다. 다른 창에서는 수신 불가.

### 해결
Rust 백엔드를 경유해서 `app_handle.emit()`으로 전체 창에 브로드캐스트.

```rust
// lib.rs - Rust 커맨드
#[tauri::command]
async fn broadcast_ticker_data(app_handle: tauri::AppHandle, symbol: String, data: serde_json::Value) -> Result<(), String> {
    let _ = app_handle.emit(&format!("kis-ticker-data-{}", symbol), data);
    Ok(())
}
```

```ts
// 프론트엔드: JS emit ❌ → Rust invoke ✅
invoke("broadcast_ticker_data", { symbol, data });
```

---

## 3. Tauri v2 — 창 테두리/그림자 제거

### 문제
`transparent: true` + `decorations: false` 설정을 해도 Windows DWM이 자동으로 1px 테두리/드롭쉐도우를 그림.

### 해결
윈도우 빌더에 `.shadow(false)` 추가.

```rust
WebviewWindowBuilder::new(...)
    .transparent(true)
    .decorations(false)
    .shadow(false)  // ← DWM 그림자 제거
    ...
```

---

## 4. Tauri v2 — 더블클릭 최대화 방지

### 문제
`WebkitAppRegion: "drag"` CSS가 적용된 영역을 더블클릭하면 OS가 창을 최대화.

### 해결
```rust
WebviewWindowBuilder::new(...)
    .maximizable(false)
    ...
```

---

## 5. Windows 태스크바 위에 창 유지 (always-on-top)

### 문제
`always_on_top(true)` 설정이 있어도 태스크바를 클릭하면 티커 창이 태스크바 뒤로 숨음.
- 락 모드에서는 `ignore_cursor_events(true)` 상태이므로 포커스 이벤트 자체가 발생하지 않아 이벤트 기반 해결 불가.
- Tauri의 `set_always_on_top(true)`를 반복 호출해도 이미 TOPMOST인 창에 대한 no-op으로 처리됨.
- `false → true` 토글은 효과는 있지만 false 상태일 때 깜빡임 발생.

### 해결
`windows-sys` crate으로 Win32 `SetWindowPos`를 직접 호출. `SWP_NOSENDCHANGING` 플래그로 Windows의 Z-order 변경 차단을 우회.

**Cargo.toml:**
```toml
[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.59", features = ["Win32_UI_WindowsAndMessaging", "Win32_Foundation"] }
```

**lib.rs:**
```rust
#[cfg(target_os = "windows")]
unsafe fn force_topmost_win32(hwnd: *mut core::ffi::c_void) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOSENDCHANGING,
    };
    SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOSENDCHANGING);
}

// setup() 안에서 백그라운드 스레드로 주기적 호출
std::thread::spawn(move || {
    loop {
        std::thread::sleep(std::time::Duration::from_millis(500));
        for (label, window) in handle.webview_windows() {
            if label.starts_with("ticker_") {
                if let Ok(hwnd) = window.hwnd() {
                    unsafe { force_topmost_win32(hwnd.0) };
                }
            }
        }
    }
});
```

> **핵심**: `SWP_NOSENDCHANGING`이 없으면 Windows가 Z-order 변경 메시지를 가로채 무효화할 수 있음.

---

## 6. CSS 스크롤바 — WebView2 환경

### 문제
WebView2에서 CSS `:hover`, `transition`, 동적 클래스 토글로 스크롤바 표시/숨기기가 신뢰할 수 없게 동작.

### 해결
네이티브 스크롤바를 완전히 숨기고 **React로 커스텀 오버레이 스크롤바 직접 구현**.

```tsx
const scrollRef = useRef<HTMLDivElement>(null);
const [scrollbarVisible, setScrollbarVisible] = useState(false);
const [scrollbarThumbHeight, setScrollbarThumbHeight] = useState(0);
const [scrollbarThumbTop, setScrollbarThumbTop] = useState(0);

const handleScroll = () => {
  const el = scrollRef.current;
  if (!el) return;
  const ratio = el.clientHeight / el.scrollHeight;
  setScrollbarThumbHeight(ratio * el.clientHeight);
  setScrollbarThumbTop((el.scrollTop / el.scrollHeight) * el.clientHeight);
  setScrollbarVisible(true);
  clearTimeout(timerRef.current);
  timerRef.current = setTimeout(() => setScrollbarVisible(false), 1000);
};

// JSX
<div ref={scrollRef} className="h-screen overflow-y-auto" onScroll={handleScroll}>
  {/* 오버레이 스크롤바 */}
  <div className="fixed right-0 top-0 bottom-0 w-2 pointer-events-none">
    <div style={{ opacity: scrollbarVisible ? 1 : 0, height: scrollbarThumbHeight, top: scrollbarThumbTop, transition: 'opacity 0.3s' }} />
  </div>
  {/* 콘텐츠 */}
</div>
```

```css
/* 네이티브 스크롤바 전역 숨김 */
*::-webkit-scrollbar { display: none; }
* { scrollbar-width: none; }
```

---

## 7. KIS API — WebSocket 구독

### 구조
```
1. POST /oauth2/Approval → 웹소켓 승인키 발급
2. WebSocket 연결: ws://ops.koreainvestment.com:21000
3. 구독 메시지 전송:
   {
     header: { approval_key, custtype: "P", tr_type: "1", content-type: "utf-8" },
     body: { input: { tr_id: "H0STCNT0", tr_key: "005930" } }
   }
```

### 주의사항
- `tr_id` / `tr_key`는 반드시 `body.input`에만 넣을 것 (`header`에 넣으면 구독 거부)
- AppKey당 WebSocket 연결은 **1개만** 허용 → 모든 종목을 하나의 연결에서 구독
- 실시간 체결 데이터: `H0STCNT0` (KRX), `H0NXCNT0` (NXT)

### 단일 WebSocket 아키텍처
```
ControlPanel (WsManager)
  └─ WebSocket 1개
       ├─ 005930 구독 → invoke("broadcast_ticker_data") → Rust emit → 모든 창
       └─ 000660 구독 → invoke("broadcast_ticker_data") → Rust emit → 모든 창

TickerWidget
  └─ listen("kis-ticker-data-005930") 수신만 담당
```

---

## 8. React StrictMode — 중복 실행 방지

### 문제
StrictMode는 개발 환경에서 `useEffect`를 **2회 실행**하므로 창 생성 등의 로직이 중복 실행됨.

### 해결
`useRef`로 실행 여부 추적 (state가 아닌 ref를 써야 리렌더링 없이 유지됨).

```tsx
const hasAutoLaunched = useRef(false);

useEffect(() => {
  if (hasAutoLaunched.current) return;
  hasAutoLaunched.current = true;
  // 창 생성 로직
}, []);
```

---

---

## 9. 윈도우 상태 저장 (위치/크기)

### 사용한 방법
- `tauri-plugin-window-state` 플러그인을 사용하여 모든 티커 창과 메인 창의 위치, 크기, 가시성 등을 자동으로 로컬에 저장하고 복원함.
- **주의**: 티커 창은 사용자 지정 라벨(`ticker_$symbol`)을 가지므로, 개별 창마다 독립적인 상태가 유지됨.

```rust
// lib.rs
.plugin(tauri_plugin_window_state::Builder::new().build())
```

---

## 10. 전역 단축키를 이용한 마우스 패스쓰루 토글

### 문제
티커 창이 항상 위에 떠 있으면서도 필요할 때만 마우스 조작이 가능해야 함.

### 해결
- `tauri-plugin-global-shortcut` 플러그인 사용.
- `Ctrl+Shift+L` 키 조합을 감지하여 `IS_LOCKED` 원자적(Atomic) 변수 상태를 반전.
- 모든 티커 창을 루프하며 `set_ignore_cursor_events(!is_locked)`를 호출.

```rust
app.global_shortcut().on_shortcut(ctrl_shift_l, move |app, _shortcut, event| {
    if event.state() == ShortcutState::Pressed {
        let new_lock = !IS_LOCKED.load(Ordering::SeqCst);
        IS_LOCKED.store(new_lock, Ordering::SeqCst);
        for (_, window) in app.webview_windows() {
            let _ = window.set_ignore_cursor_events(new_lock);
        }
    }
})?;
```

---

## 10. 메인 창 종료 시 전체 앱 종료

```rust
if let Some(main_window) = app.get_webview_window("main") {
    let app_handle = app.handle().clone();
    main_window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            app_handle.exit(0);
        }
    });
}
```

---

## 11. Tauri v2 — 윈도우 OS의 `-webkit-app-region: drag` 이벤트 탈취 현상

### 문제
티커 창의 `-webkit-app-region: drag` 영역 내부에서 사용자가 `onDoubleClick` 또는 다수의 광클 이벤트를 발생시켜도 JS(React) 상에서 더블클릭 이벤트가 인식되지 않음(10번 클릭해야 겨우 인지되는 등 오작동).

### 원인
윈도우 환경에서 드래그 가능 영역을 더블클릭할 때, OS가 이를 **'타이틀바 최대화/복원(Titlebar Maximize)'** 등의 고유 동작으로 사전 가로채기(intercept) 때문에 Chromium 브라우저 엔진 상단의 DOM 이벤트가 소실되는 Tauri 태생의 특성.

### 해결
JS 환경에서 타이머를 돌려 `onClick`이나 `onMouseUp`으로 더블클릭을 강제로 구현하려 시도하더라도 첫 번째 클릭(Focus) 이벤트부터 OS에 씹히는 경우가 많아 불안정함.

가장 깔끔한 근본 해결책은 텍스트가 존재하는 내부 콘텐츠 컨테이너 영역만 특별히 `-webkit-app-region: no-drag`를 설정하는 것임. 이렇게 되면 글자 영역에서는 OS가 창 드래그 이벤트라고 착각하지 않으므로 순정 `onDoubleClick` 이벤트 트리거가 정상적으로 작동함.

```tsx
// 글자가 있는 컨테이너 영역만 no-drag 설정
<div style={{ WebkitAppRegion: "no-drag" }}>
   <span className="text-sm ..." onDoubleClick={...}>
     {symbol}
   </span>
</div>
```

---

## 12. 전역 스케일(Scale) 조절 — CSS Transform 활용

### 문제
티커 위젯 전반의 글자 크기와 레이아웃을 한 번에 키우거나 줄여야 함. 개별 폰트 스타일을 일일이 수정하는 것은 비효율적임.

### 해결
React의 최상위 렌더링 영역에 `transform: scale(n)` 스타일을 적용하여 전체 위젯의 비율을 물리적으로 확대/축소함.

1.  **전역 브로드캐스트**: 메인 설정창(ControlPanel)에서 스케일 값을 변경하면 이를 Rust 백엔드로 `invoke` 하고, 백엔드는 전체 창에 `emit` 하여 모든 개별 티커 위젯이 즉시 동기화되도록 함.
2.  **Transform Origin**: 배율 조정 시 위젯이 화면에서 튀어나가거나 위치가 어긋나지 않도록 `transformOrigin: "center"`를 설정하여 중심을 기준으로 크기가 변하게 함.
3.  **성능**: 단순 텍스트 렌더링이므로 CSS Transform을 통한 확대/축소는 GPU 가속을 받아 매우 부드럽고 가볍게 작동함.

```

---

## 13. 주식 데이터 소스(API) 비교 분석 (2026-02-26)

### 주요 API별 특징 (국내 증권사 포함)
| API | 장점 | 단점 | 실시간성 | 방식 |
| :--- | :--- | :--- | :--- | :--- |
| **한국투자증권 (KIS)** | 공식 REST API 선두주자, 국내 주식 최적화 | 인증 절차 다소 번거로움 | **실시간** | REST, WS |
| **키움증권 (차세대)** | 최대 사용자 층, 2025 신규 REST API 출시 | 일부 기능(해외주식 등) 순차 지원 | **실시간** | REST, WS |
| **LS증권 (구 이베스트)** | 개발자 친화적 선구자, 안정적인 REST 인터페이스 | 사명 변경 후 인지도 변화 중 | **실시간** | REST, WS |
| **신한투자증권** | OAuth 2.0 기반 현대적 API 구성 | 커뮤니티 예제 상대적 부족 | 준 실시간 | REST |
| **Yahoo Finance** | 전세계 주식, 인증 불필요, 구현 쉬움 | 비공식, 지연 데이터, 차단 위험 | 지연 | REST |

### 활용 전략 (2026-02-26 업데이트)
- **최우선 (KIS)**: 현재 본 프로젝트에서 사용 중. 플랫폼 제약이 없고 웹 기술과 가장 궁합이 좋음.
- **강력한 대안 (키움 차세대)**: 키움증권이 2025년에 출시한 REST API는 기존 Windows 전용(OCX)에서 탈피하여 Mac/Linux/Web 어디서든 사용 가능함. 유튜버나 블로거 등 커뮤니티 예제가 가장 많음.
- **안정성 (LS증권)**: 과거 이베스트 시절부터 API에 진심이었던 곳으로, REST 기반 시스템 트레이딩에 잔뼈가 굵은 개발자들이 선호함.
- **결론**: 본 프로젝트(Tauri)는 웹 기반 기술을 사용하므로, **KIS, 키움(신규), LS** 세 곳이 가장 적합한 후보군임.

---

## 14. 실전(Real) vs 모의투자(Virtual) API 분리 아키텍처

### 구조 및 목적
보안과 유지보수 편의를 위해 소스 코드를 물리적으로 분리했습니다.
- **`kisApi.ts`**: 실전 투자용 엔드포인트 (`openapi.koreainvestment.com:9443`) 및 로직.
- **`kisVirtualApi.ts`**: 모의 투자용 엔드포인트 (`openapivts.koreainvestment.com:29443`) 및 로직.

### 개발 팁
1. **함수 인터페이스 통일**: 두 파일의 주요 함수(`getKisAccessToken`, `fetchCurrentPrice` 등) 시그니처를 동일하게 유지하여, 호출부(`WsManager` 등)에서 `isVirtual` 상태에 따라 삼항 연산자 등으로 쉽게 교체 가능하게 구성했습니다.
2. **토큰 캐싱**: `KisAuthStorage`를 공유하더라도, 모드 전환 시에는 반드시 `KisAuthStorage.clear()`를 호출하여 새로운 서버로부터 인증 토큰을 다시 발급받아야 인증 오류를 방지할 수 있습니다.
3. **웹소켓 포트**: 실전(21000)과 모의(31000) 포트 번호가 다르므로 `WsManager.tsx`에서 이를 정확히 분기해야 합니다.
