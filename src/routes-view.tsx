import { useRoutes } from "react-router";
import { routes } from "./main";

export function RoutesView() {
  return useRoutes(routes);
}
