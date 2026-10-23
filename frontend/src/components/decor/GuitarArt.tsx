import { useId } from 'react'

/** Fret positions along the neck (y), closer together towards the body like a real guitar. */
const FRETS = [92, 112, 131, 149, 166, 182, 197, 211, 224, 236, 247, 257]

/**
 * Decorative glowing outline of an acoustic guitar (amber to purple, like stage light on wood).
 * Purely visual: hidden from screen readers.
 */
export function GuitarArt({ className }: { className?: string }) {
  const id = useId()
  const stroke = `url(#${id}-stroke)`
  return (
    <svg className={className} viewBox="0 0 200 600" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-stroke`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffc35c" />
          <stop offset="0.55" stopColor="#f5a524" />
          <stop offset="1" stopColor="#7c5cff" />
        </linearGradient>
        <radialGradient id={`${id}-body`} cx="0.5" cy="0.6" r="0.6">
          <stop offset="0" stopColor="#f5a524" stopOpacity="0.18" />
          <stop offset="1" stopColor="#7c5cff" stopOpacity="0.04" />
        </radialGradient>
        <filter id={`${id}-glow`} x="-30%" y="-10%" width="160%" height="120%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" filter={`url(#${id}-glow)`}>
        {/* Headstock and tuning pegs */}
        <path d="M86 70 L82 8 Q100 0 118 8 L114 70 Z" />
        {[18, 36, 54].map((y) => (
          <g key={y}>
            <circle cx="72" cy={y} r="5" />
            <circle cx="128" cy={y} r="5" />
            <path d={`M77 ${y} H86 M114 ${y} H123`} />
          </g>
        ))}
        {/* Neck with nut and frets */}
        <path d="M88 70 L88 285 M112 70 L112 285" />
        <path d="M86 72 H114" strokeWidth="4" />
        {FRETS.map((y) => (
          <path key={y} d={`M88 ${y} H112`} strokeWidth="1.5" />
        ))}
        {/* Body */}
        <path
          d="M100 280 C150 280 170 310 160 360 C152 395 190 400 190 462 C190 532 150 562 100 562 C50 562 10 532 10 462 C10 400 48 395 40 360 C30 310 50 280 100 280 Z"
          fill={`url(#${id}-body)`}
        />
        {/* Sound hole with rosette */}
        <circle cx="100" cy="382" r="24" />
        <circle cx="100" cy="382" r="31" strokeWidth="1.2" strokeDasharray="3 4" />
        {/* Bridge */}
        <rect x="72" y="468" width="56" height="12" rx="4" />
      </g>
      {/* Strings, nut to bridge */}
      <g stroke="#efe6d2" strokeOpacity="0.55" strokeWidth="0.8">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <path key={i} d={`M${92 + i * 3.2} 72 L${84 + i * 6.4} 474`} />
        ))}
      </g>
    </svg>
  )
}
