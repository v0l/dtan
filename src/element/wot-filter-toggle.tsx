import { Button } from "./button";
import { useWoTFilter, WoTFilterState } from "../wot-filter";

export function WoTFilterToggle() {
  const filter = useWoTFilter();

  return (
    <div className="flex items-center gap-2 mb-4">
      <Button
        type={filter.enabled ? "primary" : "secondary"}
        small
        onClick={() => WoTFilterState.setEnabled(!filter.enabled)}
      >
        {filter.enabled ? "WoT Filter: ON" : "WoT Filter: OFF"}
      </Button>
      {filter.enabled && (
        <span className="text-sm text-neutral-400">
          Filtering by Web of Trust (max distance: {filter.maxDistance})
        </span>
      )}
    </div>
  );
}