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
    <div>
      <input
        type="text"
        placeholder="Search.."
        className="p-3 rounded w-full"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => {
          if (e.key == "Enter") {
            navigate(`/search/${encodeURIComponent(term)}${tags.length > 0 ? `?tags=${tags.join(",")}` : ""}`);
          }
        }}
      />
    </div>
  );
}
