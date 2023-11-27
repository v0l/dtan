import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { RouteObject, RouterProvider, createBrowserRouter } from "react-router-dom";
import { Layout } from "./page/layout";
import { HomePage } from "./page/home";
import { NostrSystem } from "@snort/system";
import { SnortContext } from "@snort/system-react";
import { ProfilePage } from "./page/profile";
import { NewPage } from "./page/new";
import { TorrentPage } from "./page/torrent";
import { SnortSystemDb } from "@snort/system-web";
import { SearchPage } from "./page/search";

const db = new SnortSystemDb();
const System = new NostrSystem({
  db,
});
const Routes = [
  {
    element: <Layout />,
    loader: async () => {
      await System.Init();
      for (const r of ["wss://nos.lol", "wss://relay.damus.io"]) {
        await System.ConnectToRelay(r, { read: true, write: true });
      }
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
