import { useEffect } from "react";
import { createPortal } from "react-dom";

interface PlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  magnet: string;
  path?: string;
}

/**
 * `btoa` only accepts Latin-1, so a torrent title or filename outside that range
 * (anything with Japanese, Cyrillic, emoji, ...) throws InvalidCharacterError and
 * takes the whole render down with it. Encode to UTF-8 first, then base64 the
 * bytes. Standard base64 is kept, not base64url, because that is what the player
 * decodes from the fragment.
 */
export function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

export function PlayerModal({ isOpen, onClose, magnet, path }: PlayerModalProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const playerData = {
    magnet,
    ...(path && { path }),
  };

  const base64Data = toBase64(JSON.stringify(playerData));
  const playerUrl = `https://wt-player.pages.dev/#${base64Data}`;

  const modalContent = (
    <div
      className="fixed inset-0 bg-black/80 bg-opacity-75 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div className="relative w-full max-w-7xl" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white hover:text-gray-300 text-2xl font-bold"
          aria-label="Close"
        >
          ✕
        </button>
        <div className="aspect-video w-full">
          <iframe
            src={playerUrl}
            className="w-full h-full rounded-lg"
            allow="autoplay; fullscreen"
            title="WebTorrent Player"
            // The player is a third-party Pages project. It needs scripts and its
            // own storage, but it should not be able to navigate the top frame,
            // open popups, or read a referrer that tells wt-player.pages.dev which
            // torrent page the user was on.
            sandbox="allow-scripts allow-same-origin allow-presentation"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
