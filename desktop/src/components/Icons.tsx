import type { ReactNode } from "react";

type IconProps = { size?: number; className?: string };

function Svg({ size = 18, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function IconCompose({ size = 18, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.4 2.6a1.1 1.1 0 0 1 3 3L12.2 14.8a2 2 0 0 1-.85.5l-2.88.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.85z" />
    </Svg>
  );
}

export function IconPlus({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconFolder({ size = 18, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M3 7a2 2 0 0 1 2-2h4.5l1.8 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Svg>
  );
}

export function IconChat({ size = 18, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    </Svg>
  );
}

export function IconSpark({ size = 18, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 3l1.5 5.2L19 10l-5.5 1.8L12 17l-1.5-5.2L5 10l5.5-1.8z" />
      <path d="M19 16l.6 2 2 .6-2 .6-.6 2-.6-2-2-.6 2-.6z" />
    </Svg>
  );
}

export function IconPlugin({ size = 18, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M4 7h3a1 1 0 0 0 1-1V5a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-1a2 2 0 0 0-4 0v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a2 2 0 0 0 0-4H7a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1" />
    </Svg>
  );
}

export function IconGear({ size = 18, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M9.67 4.14a2.34 2.34 0 0 1 4.66 0 2.34 2.34 0 0 0 3.32 1.91 2.34 2.34 0 0 1 2.33 4.04 2.34 2.34 0 0 0 0 3.83 2.34 2.34 0 0 1-2.33 4.03 2.34 2.34 0 0 0-3.32 1.92 2.34 2.34 0 0 1-4.66 0 2.34 2.34 0 0 0-3.32-1.92 2.34 2.34 0 0 1-2.33-4.03 2.34 2.34 0 0 0 0-3.83 2.34 2.34 0 0 1 2.33-4.04 2.34 2.34 0 0 0 3.32-1.91" />
    </Svg>
  );
}

export function IconSearch({ size = 18, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.2-3.2" />
    </Svg>
  );
}

export function IconSidebar({ size = 18, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </Svg>
  );
}

export function IconHand({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M8 13V7.5a1.5 1.5 0 0 1 3 0V12" />
      <path d="M11 11.5V6.2a1.5 1.5 0 0 1 3 0V12" />
      <path d="M14 11V8.2a1.5 1.5 0 0 1 3 0V13a5 5 0 0 1-10 0v-2" />
    </Svg>
  );
}

export function IconSend({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </Svg>
  );
}

export function IconPin({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M12 17v5" />
      <path d="M8 3h8l-1 7h3l-6 6-6-6h3z" />
    </Svg>
  );
}

export function IconEye({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function IconArchive({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <path d="M4 8h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M3 4h18v4H3z" />
      <path d="M10 12h4" />
    </Svg>
  );
}

export function IconCopy({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Svg>
  );
}

export function IconStop({ size = 16, className }: IconProps) {
  return (
    <Svg size={size} className={className}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}
