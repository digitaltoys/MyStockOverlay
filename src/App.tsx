import { useEffect } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import ControlPanel from "./pages/ControlPanel";
import TickerWidget from "./pages/TickerWidget";
import "./index.css";

// Helper component to add transparent class to body if route is /ticker/*
function Layout() {
  const location = useLocation();

  useEffect(() => {
    if (location.pathname.startsWith("/ticker")) {
      document.documentElement.classList.add("transparent-ticker");
    } else {
      document.documentElement.classList.remove("transparent-ticker");
    }
  }, [location]);

  return (
    <Routes>
      <Route path="/" element={<ControlPanel />} />
      <Route path="/ticker/:symbol" element={<TickerWidget />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  );
}

export default App;
