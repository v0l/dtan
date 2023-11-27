import { Search } from "../element/search";
import { LatestTorrents } from "../element/trending";

export function HomePage() {
  return (
    <>
      <Search />
      <LatestTorrents />
    </>
  );
}
