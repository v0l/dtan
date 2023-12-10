import { LatestTorrents } from "../element/trending";

export function HomePage() {
  return (
    <div className="flex flex-col gap-4">
      <LatestTorrents />
    </div>
  );
}
