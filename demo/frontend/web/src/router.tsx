import { createBrowserRouter, Outlet } from "react-router-dom";
import { useEffect } from "react";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import WorkspaceEntry from "@/pages/workspaces/entry";
import ConfigPage from "@/pages/config";
import CompetitionsPage from "@/pages/competitions";
import HomePage from "@/pages/home";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import VideoPage from "@/pages/video";
import WorkspaceOverview from "@/pages/workspaces";
import WelcomePage from "@/pages/welcome";

function ComfyArtEntry() {
    useEffect(() => { window.location.replace('/comfyart/'); }, []);
    return <a href="/comfyart/">打开创作画布</a>;
}

export const router = createBrowserRouter([
    { path: "/", element: <WelcomePage /> },
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/home", element: <HomePage /> },
            { path: "/image", element: <ComfyArtEntry /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <ComfyArtEntry /> },
            { path: "/canvas/:id", element: <WorkspaceEntry /> },
            { path: "/workspaces", element: <WorkspaceOverview /> },
            { path: "/config", element: <ConfigPage /> },
            { path: "/competitions", element: <CompetitionsPage /> },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
