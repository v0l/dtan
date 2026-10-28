import { Link } from "react-router-dom";
import { setStatus, useHead } from "../ssr";

export function NotFoundPage() {
  setStatus(404);
  useHead({ title: "Not found", noindex: true });
  return (
    <div className="flex flex-col gap-4">
      <h2>Not found</h2>
      <Link to="/" className="text-blue-400 hover:text-blue-300">
        Back to the latest torrents
      </Link>
    </div>
  );
}
