// Иконки из шаблона дизайна: 20×20, обводка `currentColor`.
const paths = {
  calendar: (
    <>
      <rect x="3" y="4.5" width="14" height="12.5" rx="2" />
      <path d="M3 8.5h14M7 3v3M13 3v3" />
    </>
  ),
  check: <path d="M4.5 10.5l3.5 3.5 7.5-8" />,
  clock: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6v4.5l3 1.5" />
    </>
  ),
  info: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9.2v4.6M10 6.3v.1" />
    </>
  ),
  error: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M7.5 7.5l5 5M12.5 7.5l-5 5" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="4.5" width="14" height="11" rx="2" />
      <path d="M3.5 6l6.5 5 6.5-5" />
    </>
  ),
  warning: (
    <>
      <path d="M10 3.2l7.6 13.3H2.4z" />
      <path d="M10 8.2v3.6M10 14.2v.1" />
    </>
  ),
  plus: <path d="M10 4v12M4 10h12" />,
  chevronRight: <path d="M8 5l5 5-5 5" />,
  chevronDown: <path d="M5 8l5 5 5-5" />,
  back: <path d="M16 10H4M9 5l-5 5 5 5" />,
  copy: (
    <>
      <rect x="7" y="7" width="9" height="9.5" rx="1.8" />
      <path d="M13 7V5.3A1.8 1.8 0 0 0 11.2 3.5H5.8A1.8 1.8 0 0 0 4 5.3v5.4A1.8 1.8 0 0 0 5.8 12.5H7" />
    </>
  ),
};

export type IconName = keyof typeof paths;

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon ${className}`} viewBox="0 0 20 20" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
