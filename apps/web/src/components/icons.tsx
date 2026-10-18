import type { SVGProps } from 'react';

/**
 * One icon set, drawn on a 24-unit grid with a 1.75 stroke, so every glyph has
 * the same optical weight at 18-20px. Inline SVG rather than an icon package:
 * the app must work with no network, and a dozen paths is smaller than any
 * library that would ship a thousand.
 *
 * Icons are decorative by default (`aria-hidden`) because every one of them in
 * this app sits beside a visible label. An icon that is genuinely alone must be
 * given a `<span className="sr-only">` by its caller.
 */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
    <rect x="13.5" y="3" width="7.5" height="5" rx="1.6" />
    <rect x="13.5" y="10.5" width="7.5" height="10.5" rx="1.6" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
  </Icon>
);

export const IconUsers = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
    <circle cx="9" cy="7" r="3.4" />
    <path d="M22 20v-1.5a4 4 0 0 0-3-3.87M16.5 4.13a4 4 0 0 1 0 5.74" />
  </Icon>
);

export const IconUser = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 20v-1.5a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5V20" />
    <circle cx="12" cy="7" r="3.6" />
  </Icon>
);

export const IconInbox = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 13h4.2l1.4 2.6h6.8L16.8 13H21" />
    <path d="M5.3 4.5h13.4a1.6 1.6 0 0 1 1.5 1.1L21 13v4.4A2.6 2.6 0 0 1 18.4 20H5.6A2.6 2.6 0 0 1 3 17.4V13l.8-7.4a1.6 1.6 0 0 1 1.5-1.1Z" />
  </Icon>
);

export const IconChat = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20.5 12.2a7.8 7.8 0 0 1-8.4 7.77 8.6 8.6 0 0 1-2.9-.63L4 21l1.7-4.6a7.6 7.6 0 0 1-.9-3.6 7.8 7.8 0 0 1 7.8-7.77h.5a7.79 7.79 0 0 1 7.4 7.2Z" />
  </Icon>
);

export const IconChart = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 20h18" />
    <path d="M6.5 20v-6M12 20V6M17.5 20v-9" />
  </Icon>
);

export const IconAlert = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.3 3.9a2 2 0 0 1 3.4 0l7.4 12.6a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3Z" />
    <path d="M12 9.5v4M12 17.2h.01" />
  </Icon>
);

export const IconShield = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 21s7.5-3.4 7.5-9.4V5.9L12 3 4.5 5.9v5.7C4.5 17.6 12 21 12 21Z" />
    <path d="M9 12l2.2 2.2L15.3 10" />
  </Icon>
);

export const IconFile = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 3v4.5a1.5 1.5 0 0 0 1.5 1.5H20" />
    <path d="M19.5 9.6V19a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.1Z" />
  </Icon>
);

export const IconBell = (p: IconProps) => (
  <Icon {...p}>
    <path d="M18 8.6a6 6 0 0 0-12 0c0 6-2.2 7.4-2.2 7.4h16.4S18 14.6 18 8.6Z" />
    <path d="M13.7 19.6a2 2 0 0 1-3.4 0" />
  </Icon>
);

export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10.8" cy="10.8" r="6.8" />
    <path d="M20 20l-4.4-4.4" />
  </Icon>
);

export const IconMenu = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const IconChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  </Icon>
);

export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 9.5 12 16l6.5-6.5" />
  </Icon>
);

export const IconArrowUp = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
  </Icon>
);

export const IconArrowDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M18.5 12.5 12 19l-6.5-6.5" />
  </Icon>
);

export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
  </Icon>
);

export const IconClock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7.2V12l3.2 2" />
  </Icon>
);

export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const IconLogout = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.5 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3.5" />
    <path d="M15.5 16 20 12l-4.5-4M20 12H9.5" />
  </Icon>
);

export const IconGlobe = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M3.6 12h16.8" />
    <path d="M12 3.4a13 13 0 0 1 0 17.2 13 13 0 0 1 0-17.2Z" />
  </Icon>
);

export const IconSun = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.4v2.4M12 19.2v2.4M4.4 4.4l1.7 1.7M17.9 17.9l1.7 1.7M2.4 12h2.4M19.2 12h2.4M4.4 19.6l1.7-1.7M17.9 6.1l1.7-1.7" />
  </Icon>
);

export const IconMoon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.4A8.4 8.4 0 1 1 9.6 4a6.6 6.6 0 0 0 10.4 10.4Z" />
  </Icon>
);

export const IconBuilding = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 20.5V5.5a1.5 1.5 0 0 1 1.5-1.5h7a1.5 1.5 0 0 1 1.5 1.5v15" />
    <path d="M14.5 9.5H18a1.5 1.5 0 0 1 1.5 1.5v9.5M3 20.5h18" />
    <path d="M8 8h3M8 11.5h3M8 15h3" />
  </Icon>
);

export const IconTasks = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10" />
    <path d="m3.8 6.4 1.3 1.3 2.3-2.4M3.8 11.9l1.3 1.3 2.3-2.4" />
    <circle cx="5.3" cy="17.5" r="1.3" />
  </Icon>
);

export const IconWallet = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a1.5 1.5 0 0 1 1.5 1.5V8" />
    <path d="M4 7.5v10A2.5 2.5 0 0 0 6.5 20h12a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 18.5 8h-12A2.5 2.5 0 0 1 4 7.5Z" />
    <circle cx="16" cy="14" r="1.1" />
  </Icon>
);

export const IconCap = (p: IconProps) => (
  <Icon {...p}>
    <path d="m2.5 9.5 9.5-4.5 9.5 4.5-9.5 4.5-9.5-4.5Z" />
    <path d="M6.5 11.5v4.3c0 1.2 2.5 2.7 5.5 2.7s5.5-1.5 5.5-2.7v-4.3" />
    <path d="M21.5 9.5v5" />
  </Icon>
);

export const IconMegaphone = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10v4a1 1 0 0 0 1 1h2.5l6.5 4V5L7.5 9H5a1 1 0 0 0-1 1Z" />
    <path d="M17.5 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11" />
  </Icon>
);

export const IconLayers = (p: IconProps) => (
  <Icon {...p}>
    <path d="m12 4 9 4.5-9 4.5-9-4.5L12 4Z" />
    <path d="m3 13 9 4.5 9-4.5" />
  </Icon>
);

export const IconCalendar = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);

export const IconPrinter = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 9V4h10v5" />
    <rect x="3.5" y="9" width="17" height="8" rx="1.5" />
    <path d="M7 14h10v6H7z" />
  </Icon>
);

export const IconKey = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" />
  </Icon>
);

export const IconSettings = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" />
  </Icon>
);

export const IconPassport = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <circle cx="12" cy="10" r="3" />
    <path d="M9 16.5h6" />
  </Icon>
);

export const IconDownload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4v11" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 20h14" />
  </Icon>
);

export const IconLock = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </Icon>
);

export const IconSidebar = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M9 4v16M14.5 10 12.5 12l2 2" />
  </Icon>
);

export const IconUserPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-4A4.5 4.5 0 0 0 2 18.5V20" />
    <circle cx="8.5" cy="7.5" r="3.5" />
    <path d="M19 8v6M16 11h6" />
  </Icon>
);

export const IconDots = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 12h.01M12 12h.01M18.5 12h.01" strokeWidth={3} />
  </Icon>
);

/** Nav icons are chosen by href so a nav item stays a plain data object. */
export const IconFolder = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 7.5a2 2 0 0 1 2-2h4.2l2 2.2H19a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Icon>
);
export const IconFlow = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="6" height="5" rx="1.4" />
    <rect x="15" y="4" width="6" height="5" rx="1.4" />
    <rect x="9" y="15" width="6" height="5" rx="1.4" />
    <path d="M9 6.5h6M6 9v3.5h6V15M18 9v3.5h-6" />
  </Icon>
);
export const IconBook = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
    <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5zM8.5 7.5h7M8.5 11h5" />
  </Icon>
);
export const IconHandshake = (p: IconProps) => (
  <Icon {...p}>
    <path d="m11 17 2 2a1.4 1.4 0 0 0 2-2l-1.5-1.5M14 15.5l2 2a1.4 1.4 0 0 0 2-2l-4.6-4.6a2 2 0 0 0-2.8 0l-.9.9a1.5 1.5 0 0 1-2.1-2.1L10.4 7" />
    <path d="m3 11 4-4 3.4.4M21 11l-3.5-3.5L13 9M7 15l2.5 2.5" />
  </Icon>
);
export const IconPercent = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19 5 5 19" />
    <circle cx="7" cy="7" r="2.5" />
    <circle cx="17" cy="17" r="2.5" />
  </Icon>
);
export const IconBank = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 9.5 12 4l9 5.5M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18" />
  </Icon>
);
export const IconReceipt = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3" />
  </Icon>
);
export const IconStar = (p: IconProps) => (
  <Icon {...p}>
    <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.9z" />
  </Icon>
);
export const IconShare = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="18" cy="5.5" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="18.5" r="2.5" />
    <path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1" />
  </Icon>
);
export const IconTrash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13M10 11v5.5M14 11v5.5" />
  </Icon>
);
export const IconGrid = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
  </Icon>
);
export const IconList = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
  </Icon>
);
export const IconUpload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
  </Icon>
);
export const IconCopy = (p: IconProps) => (
  <Icon {...p}>
    <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" />
    <path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
  </Icon>
);
export const IconTag = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.6 1.6 0 0 1 0 2.2l-6.3 6.3a1.6 1.6 0 0 1-2.2 0z" />
    <circle cx="8" cy="8" r="1.4" />
  </Icon>
);
export const IconEye = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);
export const IconUndo = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
);
export const IconLink = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 13.5a4.5 4.5 0 0 0 6.4.4l2.8-2.8a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2M14 10.5a4.5 4.5 0 0 0-6.4-.4l-2.8 2.8a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
  </Icon>
);
export const IconCamera = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2L9.2 5h5.6l1.5 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
    <circle cx="12" cy="12.8" r="3.2" />
  </Icon>
);
export const IconPen = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4 20 1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5zM13.5 7l3 3" />
  </Icon>
);
export const IconBoard = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16M15 4v16M5.5 8h1.5M11 8h2M17 8h1.5" />
  </Icon>
);
export const IconUniversity = (p: IconProps) => (
  <Icon {...p}>
    <path d="m2.5 9 9.5-5 9.5 5-9.5 5zM6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5M21.5 9v5.5" />
  </Icon>
);

export const NAV_ICON: Record<string, (p: IconProps) => React.JSX.Element> = {
  '/overview/roles': IconKey,
  '/overview/branding': IconStar,
  '/partner/account': IconUser,
  '/overview/documents': IconFolder,
  '/desk/documents': IconFolder,
  '/overview/workflows': IconFlow,
  '/desk/workflows': IconFlow,
  '/overview/countries': IconGlobe,
  '/desk/countries': IconGlobe,
  '/overview/pipeline': IconBoard,
  '/desk/pipeline': IconBoard,
  '/overview/courses': IconBook,
  '/desk/courses': IconBook,
  '/portal/courses': IconBook,
  '/overview/commissions': IconPercent,
  '/desk/commissions': IconPercent,
  '/overview/universities': IconUniversity,
  '/desk/universities': IconUniversity,
  '/overview/partners': IconHandshake,
  '/desk/partners': IconHandshake,
  '/desk/finance': IconBank,
  '/partner': IconDashboard,
  '/partner/students': IconUsers,
  '/partner/commissions': IconPercent,
  '/partner/payouts': IconWallet,
  '/partner/resources': IconFolder,
  '/partner/messages': IconChat,
  '/partner/agreement': IconPen,
  '/partner/team': IconUser,
  '/partner/profile': IconBuilding,
  '/admin': IconBuilding,
  '/admin/tenants/new': IconPlus,
  '/admin/plans': IconLayers,
  '/admin/settings': IconSettings,
  '/overview/subscription': IconReceipt,
  '/overview/tasks': IconTasks,
  '/overview/finance': IconWallet,
  '/overview/announcements': IconMegaphone,
  '/desk/tasks': IconTasks,
  '/desk/invoices': IconWallet,
  '/portal/payments': IconWallet,
  '/overview': IconDashboard,
  '/overview/stuck': IconAlert,
  '/overview/clients': IconUsers,
  '/overview/consultants': IconUser,
  '/overview/audit': IconShield,
  '/overview/security': IconLock,
  '/overview/export': IconDownload,
  '/desk/audit': IconShield,
  '/desk/team': IconUser,
  '/desk/export': IconDownload,
  '/desk': IconDashboard,
  '/desk/clients': IconUsers,
  '/desk/reviews': IconInbox,
  '/desk/messages': IconChat,
  '/desk/workload': IconChart,
  '/portal': IconDashboard,
  '/portal/progress': IconChart,
  '/portal/documents': IconFile,
  '/portal/messages': IconChat,
};
