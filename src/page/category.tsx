import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { categoryUrl, findCategory } from "../const";
import { setStatus, useHead } from "../ssr";
import { NotFoundPage } from "./not-found";
import { TorrentResults } from "./search";
import { Link } from "react-router-dom";

export function CategoryPage() {
  const location = useLocation();
  const path = useMemo(
    () =>
      location.pathname
        .split("/")
        .filter((s) => s.length > 0)
        .map(decodeURIComponent),
    [location.pathname],
  );
  const chain = findCategory(path);
  const title = chain?.map((c) => c.name).join(" > ") ?? "Not found";
  useHead({
    title,
    description: chain ? `Latest ${title} torrents on Nostr` : undefined,
    path: categoryUrl(path),
    noindex: !chain,
  });

  const tags = useMemo(() => (path.length === 1 ? path : []), [path]);
  const labels = useMemo(() => (path.length > 1 ? [`tcat:${path.join(",")}`] : []), [path]);

  if (!chain) {
    setStatus(404);
    return <NotFoundPage />;
  }
  const children = chain[chain.length - 1].sub_category ?? [];
  return (
    <div className="flex flex-col gap-4">
      <h2>
        {chain.map((c, i) => (
          <span key={c.tag}>
            {i > 0 && " > "}
            <Link to={categoryUrl(path.slice(0, i + 1))}>{c.name}</Link>
          </span>
        ))}
      </h2>
      {children.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {children.map((c) => (
            <Link key={c.tag} to={categoryUrl([...path, c.tag])} className="text-blue-400 hover:text-blue-300 hover:underline">
              {c.name}
            </Link>
          ))}
        </div>
      )}
      <TorrentResults tags={tags} labels={labels} />
    </div>
  );
}
