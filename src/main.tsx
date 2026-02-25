import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Ensure transparent class is added synchronously before first paint to prevent white flash glitch
if (window.location.pathname.startsWith("/ticker")) {
  document.documentElement.classList.add("transparent-ticker");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
