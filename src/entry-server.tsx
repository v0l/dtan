import { setServerLocation } from "./ssr/globals";
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { SnortContext } from "@snort/system-react";
import type { SystemInterface } from "@snort/system";
import { RoutesView } from "./routes-view";
import { App } from "./app";
import { beginSsr, endSsr } from "./ssr";
import { Categories, Category } from "./const";

const socialGraph = {
  getFollowDistance: () => 1000,
  followedByFriendsCount: () => 0,
  followedByFriends: () => new Set<string>(),
  size: () => ({ users: 0 }),
  setRoot: () => undefined,
};

const serverSystem = { config: { socialGraphInstance: socialGraph }, pool: new Map() } as unknown as SystemInterface;

export interface RenderInput {
  url: string;
}

export function render(input: RenderInput) {
  setServerLocation(input.url);
  const state = beginSsr();
  try {
    const html = renderToString(
      <SnortContext.Provider value={serverSystem}>
        <App>
          <StaticRouter location={input.url}>
            <RoutesView />
          </StaticRouter>
        </App>
      </SnortContext.Provider>,
    );
    return {
      html,
      status: state.status,
      head: state.head,
      data: { queries: state.queries, profiles: state.profiles },
    };
  } finally {
    endSsr();
  }
}

(globalThis as Record<string, unknown>).ssrRender = (json: string): string =>
  JSON.stringify(render(JSON.parse(json) as RenderInput));

(globalThis as Record<string, unknown>).ssrCategories = (): string => {
  const tags: string[] = [];
  const walk = (c: Category) => {
    tags.push(c.tag);
    c.sub_category?.forEach(walk);
  };
  Categories.forEach(walk);
  return JSON.stringify(tags);
};
