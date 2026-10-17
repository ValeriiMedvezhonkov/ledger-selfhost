/**
 * The soft colour field behind sign-in, the splash and the lock screen
 * (boards L00 / L14): five large blurred discs in system colours. Pure CSS,
 * so it paints with the server HTML and costs nothing to hydrate.
 */
const BLOBS = [
  { x: -120, y: -60, size: 360, color: "#5e5ce6" },
  { x: 180, y: 60, size: 300, color: "#ff2d55" },
  { x: 40, y: 300, size: 320, color: "#00c3d0" },
  { x: -80, y: 520, size: 300, color: "#ff8d28" },
  { x: 220, y: 560, size: 280, color: "#7d7aff" },
] as const;

export function Aurora({ dim = false }: { readonly dim?: boolean }) {
  return (
    <div aria-hidden className="aurora-root fixed-fill pointer-events-none overflow-hidden">
      <div className="relative mx-auto h-full max-w-[440px]">
        {BLOBS.map((blob) => (
          <span
            key={`${blob.x}-${blob.y}`}
            className="absolute rounded-full blur-[90px]"
            style={{
              left: blob.x,
              top: blob.y,
              width: blob.size,
              height: blob.size,
              backgroundColor: blob.color,
              opacity: dim ? 0.35 : 0.7,
            }}
          />
        ))}
      </div>
    </div>
  );
}
