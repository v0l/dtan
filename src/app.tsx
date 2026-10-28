import { ReactNode, useEffect } from "react";
import { finishHydration } from "./ssr";

export function App({ children }: { children: ReactNode }) {
  useEffect(() => finishHydration(), []);
  return <>{children}</>;
}
