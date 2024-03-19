import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { RouteObject, RouterProvider, createBrowserRouter } from "react-router-dom";

import { SnortContext } from "@snort/system-react";

import { Layout } from "./page/layout";
import { HomePage } from "./page/home";
import { ProfilePage } from "./page/profile";
import { NewPage } from "./page/new";
import { TorrentPage } from "./page/torrent";
import { SearchPage } from "./page/search";
import { System, initSystem } from "./system";

const Routes = [
  {
    element: <Layout />,
    loader: async () => {
      await initSystem();
      return null;
    },
    children: [
      {
        path: "/",
        element: <HomePage />,
      },
      {
        path: "/p/:id",
        element: <ProfilePage />,
      },
      {
        path: "/new",
        element: <NewPage />,
      },
      {
        path: "/e/:id",
        element: <TorrentPage />,
      },
      {
        path: "/search/:term?",
        element: <SearchPage />,
      },
    ],
  },
] as Array<RouteObject>;

const Router = createBrowserRouter(Routes);
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SnortContext.Provider value={System}>
      <RouterProvider router={Router} />
    </SnortContext.Provider>
  </React.StrictMode>,
);
