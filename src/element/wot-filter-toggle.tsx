import { Button } from "./button";
import { useWoT, WoTState } from "../wot";

export function WoTFilterToggle() {
  const wot = useWoT();

  return (
    <div className="flex items-center gap-2 mb-4">
      <Button
        type={wot.enabled ? "primary" : "secondary"}
        small
        onClick={() => WoTState.setEnabled(!wot.enabled)}
      >
        {wot.enabled ? "WoT Filter: ON" : "WoT Filter: OFF"}
      </Button>
      {wot.enabled && (
        <span className="text-sm text-neutral-400">
          Showing only torrents from {wot.trustedPubkeys.size} trusted users
        </span>
      )}
    </div>
  );
}