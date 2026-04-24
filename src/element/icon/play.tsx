export default function PlayIcon({ size }: { size?: number }) {
  return (
    <svg width={size ?? 20} height={size ?? 20}>
      <use href="#icon-play" />
    </svg>
  );
}
