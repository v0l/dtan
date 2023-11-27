import { Search } from "../element/search";
import { LatestTorrents } from "../element/trending";

export function HomePage() {
  return (
    <div className="flex flex-col gap-2">
      <Search />
      <LatestTorrents />
    </div>
  );
}
