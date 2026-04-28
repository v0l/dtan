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
const relayConnect = Promise.all(DefaultRelays.map((r) => system.ConnectToRelay(r, { read: true, write: false })))

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

  // First render: discovers queries via useRequestBuilder → system.Query(rb),
  // but React never calls subscribe during SSR so q.start() is never invoked.
  renderToString(app);

  // Collect query ids discovered during the render pass so we can cancel them after.
  // This must happen after renderToString so we capture all registered queries.
  const queryIds = system.takeSnapshot().queries.map((q) => q.id);

  // Start all queries discovered during the first render, then wait for data.
  for (const q of queryIds) {
    system.GetQuery(q.id)?.start();
  }
  await system.FetchAll();

  // Second render: queries now have data in their snapshots.
  const html = renderToString(app);

  const hydrationScript = getHydrationScript(system);

  // Cancel queries from this request so stale data doesn't leak into the next.
  // The QueryManager deduplicates by id, so without this a subsequent SSR
  // request for a different page would get back the old Query with old data.
  for (const id of queryIds) {
    system.GetQuery(id)?.cancel();
  }

  const resultHtml = template.replace('<!--app-html-->', html).replace('</head>', `${hydrationScript}</head>`);

  return { html: resultHtml, status: 200 };
}
