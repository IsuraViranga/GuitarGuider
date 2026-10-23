/** A small guitar pick shape (decorative; used for difficulty and the celebration). */
export function GuitarPick({ className, filled = true }: { className?: string; filled?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path
        d="M32 61C20 52 6 33 6 18 6 9 17 4 32 4s26 5 26 14c0 15-14 34-26 43z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="5"
      />
    </svg>
  )
}
