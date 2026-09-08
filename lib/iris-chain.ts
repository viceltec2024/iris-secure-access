export const BASE_MAINNET_CHAIN_ID = "0x2105" as const;
export const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export type WalletProvider = "watch" | "metamask" | "robinhood";

export type WalletSessionRecord = {
  address: string;
  mode: WalletProvider;
};

export function isEvmAddress(value: string) {
  return EVM_ADDRESS_PATTERN.test(value.trim());
}

export function normalizeEvmAddress(value: string) {
  return value.trim();
}

export function isWalletProvider(value: string): value is WalletProvider {
  return value === "watch" || value === "metamask" || value === "robinhood";
}

export function parseWalletSessionValue(value: string): WalletSessionRecord | null {
  const trimmed = value.trim();
  if (isEvmAddress(trimmed)) {
    return { address: normalizeEvmAddress(trimmed), mode: "watch" };
  }
  try {
    const parsed = JSON.parse(trimmed) as { address?: string; mode?: string };
    if (!parsed.address || !isEvmAddress(parsed.address)) return null;
    return {
      address: normalizeEvmAddress(parsed.address),
      mode: isWalletProvider(parsed.mode || "") ? parsed.mode : "watch",
    };
  } catch {
    return null;
  }
}

export function serializeWalletSessionValue(address: string, mode: WalletProvider) {
  return JSON.stringify({ address: normalizeEvmAddress(address), mode });
}
