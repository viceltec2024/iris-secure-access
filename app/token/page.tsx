import Image from "next/image";

const CONTRACT = "0x19C7936d1c7327c304a8F8AE3BAEe3D19855Ab2f";

export const metadata = { title: "IRIS Token — Official Base Contract", description: "Official IRIS Token metadata and Base Mainnet contract address." };

export default function IrisTokenPage() {
  return <main className="token-public-page"><section className="token-public-card">
    <Image src="/assets/iris-token.svg" alt="IRIS Token logo" width={180} height={180} priority />
    <p className="token-public-kicker">OFFICIAL TOKEN · BASE MAINNET</p><h1>IRIS Token</h1>
    <p className="token-public-lead">The fixed-supply utility token for the IRIS security and AI ecosystem.</p>
    <dl className="token-public-details"><div><dt>Symbol</dt><dd>IRIS</dd></div><div><dt>Network</dt><dd>Base Mainnet</dd></div><div><dt>Chain ID</dt><dd>8453</dd></div><div><dt>Decimals</dt><dd>18</dd></div><div><dt>Total supply</dt><dd>1,000,000,000 IRIS</dd></div></dl>
    <div className="token-public-contract"><span>Official contract address</span><code>{CONTRACT}</code></div>
    <div className="token-public-links"><a href={`https://base.blockscout.com/address/${CONTRACT}`} target="_blank" rel="noreferrer">View on Blockscout</a><a href={`https://basescan.org/token/${CONTRACT}`} target="_blank" rel="noreferrer">View on BaseScan</a></div>
    <p className="token-public-warning">Always verify the network and full contract address before interacting with IRIS.</p>
  </section></main>;
}
