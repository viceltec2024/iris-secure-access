import { createEVMClient } from "@metamask/connect-evm";

export const BASE_MAINNET_CHAIN_ID = "0x2105" as const;

let clientPromise: ReturnType<typeof createEVMClient> | null = null;

export function getMetaMaskClient() {
  if (!clientPromise) {
    clientPromise = createEVMClient({
      dapp: {
        name: "IRIS Secure Access",
        url: window.location.origin,
        iconUrl: `${window.location.origin}/favicon.svg`,
      },
      api: {
        supportedNetworks: {
          [BASE_MAINNET_CHAIN_ID]: "https://mainnet.base.org",
        },
      },
      ui: {
        headless: false,
        preferExtension: true,
        showInstallModal: true,
      },
      mobile: {
        useDeeplink: true,
      },
      analytics: {
        enabled: false,
      },
    });
  }
  return clientPromise;
}
