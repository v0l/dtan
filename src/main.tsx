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
import { NotFoundPage } from "./page/not-found";
import { CategoryPage } from "./page/category";
import { Categories } from "./const";

export const routes = [
  {
    element: <Layout />,
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
      ...Categories.map((c) => ({ path: `/${c.tag}/*`, element: <CategoryPage /> })),
      {
        path: "/relays",
        element: <RelaysPage />,
      },
      {
        path: "/login",
        element: <LoginPage />,
      },
      {
        path: "*",
        element: <NotFoundPage />,
      },
    ],
  },
] as Array<RouteObject>;
