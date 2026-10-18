// The Preciops-ATMS logo: the crosshair "P" mark and the wordmark. Drawn inline (no image request) so it's sharp at
// any size and can switch to white on dark backgrounds. Source artwork: public/brand/.
export const BRAND = { navy: '#0B1F3A', teal: '#0E9F8E', name: 'Preciops-ATMS', tagline: 'Advanced Talent Management Systems' };

export function LogoMark({ size = 32, light = false, title }: { size?: number; light?: boolean; title?: string }) {
  const ink = light ? '#FFFFFF' : BRAND.navy;
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false" style={{ flex: 'none' }}>
      <g fill={ink}>
        <circle cx="128" cy="128" r="112" fill="none" stroke={ink} strokeWidth="12" />
        <rect x="122" y="4" width="12" height="30" /><rect x="122" y="222" width="12" height="30" /><rect x="4" y="122" width="30" height="12" /><rect x="222" y="122" width="30" height="12" />
        <path fillRule="evenodd" d="M89 63A6 6 0 0 1 95 57H136A50 50 0 0 1 136 157H115V197H89ZM115 81H131A24 24 0 0 1 131 129H115Z" />
      </g>
      <circle cx="136" cy="105" r="11" fill={BRAND.teal} />
    </svg>
  );
}

/** Mark + "Preciops-ATMS" (with "ops" in teal on light backgrounds, all white on dark ones, as in the brand sheet). */
export function Logo({ size = 32, light = false, tagline = false, className }: { size?: number; light?: boolean; tagline?: boolean; className?: string }) {
  return (
    <span className={`logo${light ? ' light' : ''}${className ? ` ${className}` : ''}`} style={{ ['--logo' as string]: `${size}px` }}>
      <LogoMark size={size} light={light} />
      <span className="logo-text">
        <span className="logo-word" aria-label={BRAND.name}>Preci<span className="logo-ops">ops</span>-ATMS</span>
        {tagline && <span className="logo-tag">{BRAND.tagline}</span>}
      </span>
    </span>
  );
}
