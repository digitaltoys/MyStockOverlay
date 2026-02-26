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

## 9. 윈도우 상태 저장 (위치/크기)

### 사용한 방법
- Rust 백엔드에서 `Moved` / `Resized` 이벤트 감지 → 프론트로 `window-moved` 이벤트 emit
- 프론트에서 300ms 디바운스 후 `localStorage`에 `{ x, y }` 저장
- 창 생성 시 저장된 위치를 읽어 `spawn_ticker_window` 커맨드에 전달

```rust
// 창 이동/리사이즈 감지
window.on_window_event(move |event| {
    if matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)) {
        let _ = window_clone.emit("window-moved", ());
    }
});
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

```tsx
// TickerWidget.tsx
<div style={{ transform: `scale(${scale})`, transformOrigin: "center" }}>
   <TickerCard ... />
</div>
```
