import { Link } from "react-router-dom";
import { CategoryLatestTorrents } from "../element/category-latest";
import { Categories } from "../const";
import { useHead } from "../ssr";

export function HomePage() {
  useHead({ title: "", description: "Torrents on Nostr", path: "/" });
  return (
    <div className="flex flex-col gap-12">
      <Link to="/categories" className="text-blue-400 hover:text-blue-300 text-sm">
        Browse Torrents
      </Link>
      {Categories.map((category) => (
        <CategoryLatestTorrents key={category.tag} tags={[category.tag]} title={category.name} limit={10} />
      ))}
    </div>
  );
}
