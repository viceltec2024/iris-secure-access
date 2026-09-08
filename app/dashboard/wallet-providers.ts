import { BASE_MAINNET_CHAIN_ID } from "../../lib/iris-chain";

export type InjectedProvider = {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  isMetaMask?: boolean;
  isRobinhood?: boolean;
  isRobinhoodWallet?: boolean;
  providers?: InjectedProvider[];
};

function ethereum(): InjectedProvider | undefined {
  return (window as Window & { ethereum?: InjectedProvider }).ethereum;
}

export function detectInjectedProvider(kind: "metamask" | "robinhood") {
  const root = ethereum();
  if (!root) return null;
  const list = root.providers?.length ? root.providers : [root];
  if (kind === "metamask") {
    return list.find(item => item.isMetaMask && !item.isRobinhood && !item.isRobinhoodWallet) || (root.isMetaMask ? root : null);
  }
  return list.find(item => item.isRobinhood || item.isRobinhoodWallet) || null;
}

async function ensureBase(provider: InjectedProvider) {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_MAINNET_CHAIN_ID }] });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? Number(error.code) : 0;
    if (code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: BASE_MAINNET_CHAIN_ID,
          chainName: "Base Mainnet",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://mainnet.base.org"],
          blockExplorerUrls: ["https://basescan.org"],
        }],
      });
      return;
    }
    if (code === 4001) throw error;
  }
}

export async function connectInjectedWallet(kind: "metamask" | "robinhood") {
  const provider = detectInjectedProvider(kind);
  if (!provider) return null;
  const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
  await ensureBase(provider);
  return { address: accounts[0] || "", provider };
}
