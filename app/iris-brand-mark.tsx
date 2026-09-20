export default function IrisBrandMark({ className = "", size = 40 }: { className?: string; size?: number }) {
  return (
    <svg
      className={`iris-brand-mark ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M16 3.1 26.6 7.2v8.2c0 7.1-4 12.8-10.6 15.5C9.4 28.2 5.4 22.5 5.4 15.4V7.2L16 3.1Z"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinejoin="round"
      />
      <path
        d="M16 10.4v11.4M12.4 10.4h7.2M12.4 21.8h7.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
