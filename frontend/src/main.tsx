import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { AuthProvider } from "./contexts/AuthContext";
import { ChartSyncProvider } from "./shared/chart/ChartSyncContext";

import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ChartSyncProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ChartSyncProvider>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
