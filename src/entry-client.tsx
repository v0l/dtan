import "./index.css";
import { createRoot, hydrateRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { SnortContext } from "@snort/system-react";
import { routes } from "./main";
import { System, initSystem } from "./system";
import { App } from "./app";
import { finishHydration, loadHydration } from "./ssr";

loadHydration();
await initSystem();

const root = document.getElementById("root")!;
const app = (
  <SnortContext.Provider value={System}>
    <App>
      <RouterProvider router={createBrowserRouter(routes)} />
    </App>
  </SnortContext.Provider>
);

if (root.childElementCount > 0) {
  hydrateRoot(root, app);
} else {
  finishHydration();
  createRoot(root).render(app);
}
