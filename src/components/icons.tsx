/**
 * Tiny inline SVG icon set. Keeps us off external icon CDNs and lets every
 * icon respect `currentColor` so we can tint per-card / per-badge.
 *
 * One file rather than per-icon modules to keep imports tidy:
 *   import { PawIcon, SparkleIcon } from "@/components/icons";
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function baseProps({ size = 20, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };
}

export function PawIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)} fill="currentColor" stroke="none">
      <ellipse cx="12" cy="16" rx="5" ry="4" />
      <circle cx="6" cy="9" r="2.2" />
      <circle cx="9.5" cy="6" r="2.2" />
      <circle cx="14.5" cy="6" r="2.2" />
      <circle cx="18" cy="9" r="2.2" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)} fill="currentColor" stroke="none">
      <path d="M12 2l1.7 4.6L18 8l-4.3 1.7L12 14l-1.7-4.3L6 8l4.3-1.4L12 2zM19 14l.9 2.4L22 17l-2.1.6L19 20l-.9-2.4L16 17l2.1-.6L19 14zM5 13l.7 2L8 15.7l-2.3.7L5 19l-.7-2.6L2 15.7l2.3-.7L5 13z" />
    </svg>
  );
}

export function HeartIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)} fill="currentColor" stroke="none">
      <path d="M12 21s-7-4.6-7-10.2A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 7 4.8C19 16.4 12 21 12 21z" />
    </svg>
  );
}

export function XIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

/* ───────────────────── Category icons ───────────────────── */

export function CategoryPetIcon(props: IconProps) {
  return <PawIcon {...props} />;
}

export function CategoryEggIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)} fill="currentColor" stroke="none">
      <path d="M12 2c-4 0-7 5.5-7 10.5S8 21 12 21s7-3 7-8.5S16 2 12 2z" />
    </svg>
  );
}

export function CategoryVehicleIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M3 13l2-5a2 2 0 0 1 2-1.4h10a2 2 0 0 1 2 1.4l2 5" />
      <path d="M3 13h18v4a1 1 0 0 1-1 1h-2v-2H6v2H4a1 1 0 0 1-1-1v-4z" />
      <circle cx="7.5" cy="17.5" r="1.5" fill="currentColor" />
      <circle cx="16.5" cy="17.5" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function CategoryToyIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)} fill="currentColor" stroke="none">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" fill="#fff" />
    </svg>
  );
}

export function CategoryStrollerIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M4 6h7v8H6a2 2 0 0 1-2-2V6z" />
      <path d="M11 6c4 0 7 4 7 8h-7V6z" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="16" cy="18" r="2" />
    </svg>
  );
}

export function CategoryPetWearIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M4 8l4-3 4 2 4-2 4 3-2 3v8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-8L4 8z" />
    </svg>
  );
}

export function CategoryFoodIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M3 11h18l-2 7H5l-2-7z" />
      <path d="M3 11a9 4 0 1 1 18 0" />
    </svg>
  );
}

export function CategoryGiftIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <rect x="3" y="9" width="18" height="11" rx="1" />
      <path d="M3 13h18" />
      <path d="M12 9v11" />
      <path d="M8 9c-2.5 0-3.5-3.5 0-3.5C10 5.5 12 9 12 9s2-3.5 4-3.5c3.5 0 2.5 3.5 0 3.5" />
    </svg>
  );
}

export function CategoryPotionIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M9 3h6" />
      <path d="M10 3v5l-3 6a4 4 0 0 0 4 7h2a4 4 0 0 0 4-7l-3-6V3" />
    </svg>
  );
}

export function CategoryOtherIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 4 2c-.8.7-1.5 1.4-1.5 2.5" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </svg>
  );
}
