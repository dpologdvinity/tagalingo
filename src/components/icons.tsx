/** Inline SVG icon set (24px grid, currentColor). Decorative unless a `title` is given. */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { title?: string; size?: number };

function Svg({ title, size = 24, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? "img" : undefined} {...rest}>
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

/** Streak: a sun (araw means both "day" and "sun"). */
export const SunIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="5" fill="currentColor" />
    {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
      <rect key={a} x="11" y="1.5" width="2" height="4" rx="1" fill="currentColor" transform={`rotate(${a} 12 12)`} />
    ))}
  </Svg>
);

export const HeartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path
      fill="currentColor"
      d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.1 4.3 2.4h2c.7-1.3 2.2-2.4 4.3-2.4 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z"
    />
  </Svg>
);

export const BoltIcon = (p: IconProps) => (
  <Svg {...p}>
    <path fill="currentColor" d="M13.5 2 4 13.5h6.5L9.5 22 20 9.5h-6.6L13.5 2z" />
  </Svg>
);

export const PathIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 20c0-4 12-4 12-8S6 8 6 4" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    <circle cx="6" cy="20" r="2.5" fill="currentColor" />
    <circle cx="6" cy="4" r="2.5" fill="currentColor" />
  </Svg>
);

export const TrophyIcon = (p: IconProps) => (
  <Svg {...p}>
    <path
      fill="currentColor"
      d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.4A5 5 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1A5 5 0 0 1 8.4 12H8a4 4 0 0 1-4-4V5h3V3zm0 4H6v1a2 2 0 0 0 1 1.7V7zm10 0v2.7A2 2 0 0 0 18 8V7h-1z"
    />
  </Svg>
);

export const UserIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4.5" fill="currentColor" />
    <path fill="currentColor" d="M3 21c0-4.4 4-7 9-7s9 2.6 9 7H3z" />
  </Svg>
);

export const PencilIcon = (p: IconProps) => (
  <Svg {...p}>
    <path fill="currentColor" d="m15.2 3.8 5 5L9 20H4v-5L15.2 3.8zM14 7.4 6 15.4V18h2.6l8-8L14 7.4z" />
  </Svg>
);

export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <path fill="currentColor" d="M7 10V8a5 5 0 0 1 10 0v2h1.5v11h-13V10H7zm2.5 0h5V8a2.5 2.5 0 0 0-5 0v2z" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </Svg>
);

export const StarIcon = (p: IconProps) => (
  <Svg {...p}>
    <path fill="currentColor" d="m12 2.5 2.9 6 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.2 1.3-6.6L2.5 9.3l6.6-.8L12 2.5z" />
  </Svg>
);
