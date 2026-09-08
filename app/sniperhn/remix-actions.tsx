"use client";

import { useState } from "react";
import { SNIPERHN_REMIX_SOURCE } from "./sniperhn-remix";

export default function RemixActions({ remixUrl }: { remixUrl: string }) {
  const [copied, setCopied] = useState(false);

  async function copySource() {
    await navigator.clipboard.writeText(SNIPERHN_REMIX_SOURCE);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  return (
    <div className="token-public-links">
      <a href={remixUrl} target="_blank" rel="noreferrer">Open SNIPERHN in Remix</a>
      <button type="button" onClick={() => void copySource()}>{copied ? "Copied" : "Copy Solidity"}</button>
    </div>
  );
}
