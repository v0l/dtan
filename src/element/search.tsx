import { useNavigate, useParams } from "react-router-dom";
import { Categories } from "../const";
import { useEffect, useState } from "react";

export function Search() {
  const params = useParams();
  const navigate = useNavigate();
  const [term, setTerm] = useState("");

  useEffect(() => {
    setTerm(params.term ?? "");
  }, [params.term]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-3 flex-wrap">
        {Categories.map((a) => (
          <div className="flex gap-1" key={a.tag}>
            <input type="checkbox" />
            <label>{a.name}</label>
          </div>
        ))}
      </div>
      <input
        type="text"
        placeholder="Search.."
        className="p-3 rounded grow"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => {
          if (e.key == "Enter") {
            navigate(`/search/${encodeURIComponent(term)}`);
          }
        }}
      />
    </div>
  );
}
