import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./style.css";

// 데모 빌드(VITE_DEMO=true)에서는 백엔드 대신 가짜 응답을 쓴다.
if (import.meta.env.VITE_DEMO === "true") {
  const { installDemoBackend } = await import("./demo.js");
  installDemoBackend();
}

createRoot(document.getElementById("root")).render(<App />);
