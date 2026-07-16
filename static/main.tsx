import React from "react";
import { createRoot } from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";

window.__TREND_API_ENDPOINT__ = "https://lucia-trend-api.lucia-trend.workers.dev/api/trend";

createRoot(document.getElementById("root")!).render(<React.StrictMode><Home /></React.StrictMode>);
