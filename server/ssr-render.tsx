import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router-dom";
import { routes } from "../src/main";
import { NostrSystem } from "@snort/system";
import { SnortContext } from "@snort/system-react";
import { getHydrationScript } from "../src/ssr-hydration";
import { DefaultRelays, IsSSR } from "../src/const";

export interface SSRResult {
  html: string;
  status: number;
}

console.log(`ServerConfig:\n\tSSR=${IsSSR}\n\tRelays=${DefaultRelays.join(",")}`);

const system = new NostrSystem({});
const relayConnect = Promise.all(DefaultRelays.map((r) => system.ConnectToRelay(r, { read: true, write: false })));

export async function renderPage(
  url: string,
  template: string,
  acceptLanguage?: string | null,
  cookie?: string | null,
): Promise<SSRResult> {
  await relayConnect;

  const handler = createStaticHandler(routes);

  const headers: Record<string, string> = { accept: "text/html" };
  if (acceptLanguage) headers["accept-language"] = acceptLanguage;
  if (cookie) headers["cookie"] = cookie;

  const fetchRequest = new Request(`http://localhost${url}`, {
    method: "GET",
    headers,
  });

  const context = await handler.query(fetchRequest);

  if (context instanceof Response) {
    return { html: "", status: context.status };
  }

  const router = createStaticRouter(handler.dataRoutes, context);

  const app = (
    <SnortContext.Provider value={system}>
      <StaticRouterProvider router={router} context={context} />
    </SnortContext.Provider>
  );

  // First pass: useRequestBuilder creates queries via system.Query(rb).
  // Component-level keepAlive options keep queries alive between requests,
  // so when the same page is requested again, QueryManager reuses existing
  // queries with cached data — no new relay requests needed.
  renderToString(app);

  // FetchAll starts any newly-registered queries and waits for EOSE.
  // For keepAlive'd queries with finished traces, this returns instantly.
  await system.FetchAll();

  // Second pass: populate HTML with fetched data.
  const html = renderToString(app);

  // Cancel all queries that were touched during this render to start their
  // keepAlive countdown.  React doesn't call useSyncExternalStore's subscribe
  // during SSR, so cancel() never fires naturally.  Queries with a keepAlive
  // survive the 30s window and are reused next time; queries without keepAlive
  // get the default 1s TTL and are cleaned up by the QueryManager interval.
  const snapshot = system.takeSnapshot();
  for (const q of snapshot.queries) {
    system.GetQuery(q.id)?.cancel();
  }

  const hydrationScript = getHydrationScript(system);

  const resultHtml = template.replace("<!--app-html-->", html).replace("</head>", `${hydrationScript}</head>`);

  return { html: resultHtml, status: 200 };
}
