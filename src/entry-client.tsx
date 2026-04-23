import "./index.css";
import { hydrateRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { SnortContext } from "@snort/system-react";
import { routes } from "./main";
import { System } from "./system";
import { hydrateSnort } from "./ssr-hydration";

hydrateSnort(System);

const router = createBrowserRouter(routes);

hydrateRoot(
  document.getElementById("root")!,
  <SnortContext.Provider value={System}>
    <RouterProvider router={router} />
  </SnortContext.Provider>,
);
