import Image from "next/image";

export default function IrisTokenMark({ className = "", size = 40 }: { className?: string; size?: number }) {
  return (
    <Image
      className={`iris-token-emblem ${className}`.trim()}
      src="/assets/iris-token.svg"
      alt=""
      width={size}
      height={size}
      draggable={false}
      unoptimized
    />
  );
}
