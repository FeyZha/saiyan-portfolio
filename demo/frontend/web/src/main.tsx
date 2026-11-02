import React from "react";
import { createRoot } from "react-dom/client";
import "streamdown/styles.css";
import "./styles/globals.css";
import { RouterProvider } from "react-router-dom";

import "@/i18n";
import { initAnalytics } from "@/lib/analytics";
import { bootstrapWorkbench } from "@/lib/workbench-bootstrap";

initAnalytics();

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

async function start() {
await bootstrapWorkbench();
const [{ AppProviders }, { router }] = await Promise.all([import('@/components/layout/app-providers'), import('@/router')]);
createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);
}
void start().catch((error) => {
    const root = document.getElementById('root')!;
    root.textContent = error instanceof Error ? error.message : '工作台加载失败，请刷新重试。';
    root.style.padding = '40px';
});
