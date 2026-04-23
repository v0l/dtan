import { RouteObject } from "react-router-dom";
import { Layout } from "./page/layout";
import { HomePage } from "./page/home";
import { ProfilePage } from "./page/profile";
import { NewPage } from "./page/new";
import { TorrentPage } from "./page/torrent";
import { SearchPage } from "./page/search";
import { RelaysPage } from "./page/relays";
import LoginPage from "./page/login";
import { CategoriesPage } from "./page/categories";

export const routes = [
  {
    element: <Layout />,
    loader: async () => {
      if (!import.meta.env.SSR) {
        await (await import("./system")).initSystem();
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
      {
        path: "/categories/:tcat?",
        element: <CategoriesPage />,
      },
      {
        path: "/relays",
        element: <RelaysPage />,
      },
      {
        path: "/login",
        element: <LoginPage />,
      },
    ],
  },
] as Array<RouteObject>;
