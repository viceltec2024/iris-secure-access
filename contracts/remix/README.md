# SNIPERHN on Remix

Fixed-supply ERC-20 named **SNIPERHN**. The wallet that deploys the contract receives the full **1,000,000,000** supply.

## Fastest path

1. Open [Remix with SNIPERHN loaded](https://app.remix.live).
2. Confirm compiler **0.8.36**, optimizer **on**, runs **200**.
3. Compile `SNIPERHN.sol`.
4. Open **Deploy & Run**, pick **Remix VM** first to test with no gas.
5. Click **Deploy**. Call `name`, `symbol`, `decimals`, `totalSupply`, and `MAX_SUPPLY`.
6. When ready for a live network, switch environment to **Injected Provider - MetaMask**, select Base Sepolia or Base Mainnet, and deploy again.

Use the in-app page `/sniperhn` for a one-click Remix link that already contains this source.

## Manual paste

If the one-click link is unavailable:

1. Go to [https://app.remix.live](https://app.remix.live).
2. Create `contracts/SNIPERHN.sol`.
3. Paste `contracts/remix/SNIPERHN.sol` (Remix resolves `@openzeppelin/contracts@5.6.1`).
4. If npm imports fail, paste `contracts/remix/SNIPERHN.flattened.sol` instead. That file has no imports.

## Token parameters

| Field | Value |
| --- | --- |
| Name | SNIPERHN |
| Symbol | SNIPERHN |
| Decimals | 18 |
| Total supply | 1,000,000,000 SNIPERHN |
| Mint | All tokens to `msg.sender` at deploy |
| License | MIT |

Deploying on a live network spends real gas. Test on Remix VM, then a testnet, before Base Mainnet.
