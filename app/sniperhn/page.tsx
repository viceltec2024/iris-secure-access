import Image from "next/image";
import RemixActions from "./remix-actions";
import {
  SNIPERHN_COMPILER,
  SNIPERHN_DECIMALS,
  SNIPERHN_NAME,
  SNIPERHN_REMIX_SOURCE,
  SNIPERHN_REMIX_URL,
  SNIPERHN_SYMBOL,
  SNIPERHN_TOTAL_SUPPLY,
} from "./sniperhn-remix";

export const metadata = {
  title: "SNIPERHN Token — Remix deploy",
  description: "Compile and deploy the SNIPERHN ERC-20 token in Remix IDE.",
};

export default function SniperhnTokenPage() {
  return (
    <main className="token-public-page sniperhn-page">
      <section className="token-public-card">
        <Image src="/assets/sniperhn-token.svg" alt="SNIPERHN token logo" width={180} height={180} priority />
        <p className="token-public-kicker">ERC-20 · REMIX READY</p>
        <h1>{SNIPERHN_NAME}</h1>
        <p className="token-public-lead">Fixed-supply token for Remix. The deployer wallet receives the full supply at construction.</p>
        <dl className="token-public-details">
          <div><dt>Name</dt><dd>{SNIPERHN_NAME}</dd></div>
          <div><dt>Symbol</dt><dd>{SNIPERHN_SYMBOL}</dd></div>
          <div><dt>Decimals</dt><dd>{SNIPERHN_DECIMALS}</dd></div>
          <div><dt>Total supply</dt><dd>{Number(SNIPERHN_TOTAL_SUPPLY).toLocaleString("en-US")} {SNIPERHN_SYMBOL}</dd></div>
          <div><dt>Compiler</dt><dd>{SNIPERHN_COMPILER}</dd></div>
        </dl>
        <RemixActions remixUrl={SNIPERHN_REMIX_URL} />
        <ol className="sniperhn-steps">
          <li>Open Remix with the SNIPERHN source already loaded.</li>
          <li>Confirm Solidity {SNIPERHN_COMPILER.split("+")[0]}, optimizer on, 200 runs, then compile.</li>
          <li>Use Remix VM first. Deploy and check <code>name</code>, <code>symbol</code>, and <code>totalSupply</code>.</li>
          <li>Switch to Injected Provider - MetaMask for a live network. Testnet before mainnet.</li>
        </ol>
        <div className="token-public-contract">
          <span>Remix Solidity source</span>
          <pre className="sniperhn-source"><code>{SNIPERHN_REMIX_SOURCE}</code></pre>
        </div>
        <p className="token-public-warning">Live-network deploys spend real gas. Always review the MetaMask prompt before confirming.</p>
      </section>
    </main>
  );
}
