import { createEVMClient } from "@metamask/connect-evm";
import { BASE_MAINNET_CHAIN_ID } from "../../lib/iris-chain";

export { BASE_MAINNET_CHAIN_ID };

let clientPromise: ReturnType<typeof createEVMClient> | null = null;
const displayUriListeners = new Set<(uri: string) => void>();

export function subscribeMetaMaskDisplayUri(listener: (uri: string) => void) {
  displayUriListeners.add(listener);
  return () => displayUriListeners.delete(listener);
}

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
        headless: true,
        preferExtension: true,
        showInstallModal: false,
      },
      mobile: {
        useDeeplink: true,
      },
      analytics: {
        enabled: false,
      },
      eventHandlers: {
        displayUri: (uri) => {
          displayUriListeners.forEach(listener => listener(uri));
        },
      },
    });
  }
  return clientPromise;
}
