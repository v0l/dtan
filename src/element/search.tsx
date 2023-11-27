import { Categories } from "../const";

export function Search() {
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
      <input type="text" placeholder="Search.." className="p-3 rounded grow" />
    </div>
  );
}
