import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";

export function Search(params: { term?: string; tags?: Array<string> }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [tags, setTags] = useState<Array<string>>([]);

  useEffect(() => {
    setTerm(params.term ?? "");
    setTags(params.tags ?? []);
  }, [params]);

  return (
    <input
      type="text"
      placeholder="Search..."
      className="px-4 py-3 bg-neutral-800 rounded-full w-full focus-visible:outline-none"
      value={term}
      onChange={(e) => setTerm(e.target.value)}
      onKeyDown={(e) => {
        if (e.key == "Enter") {
          navigate(`/search/${encodeURIComponent(term)}${tags.length > 0 ? `?tags=${tags.join(",")}` : ""}`);
        }
      }}
    />
  );
}
