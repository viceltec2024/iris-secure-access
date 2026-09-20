const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function receiptSucceeded(status: string | number | null | undefined) {
  return status === "0x1" || status === "0x01" || status === 1 || status === "1";
}

export function deploymentFromReceipt(receipt: { contractAddress?: string | null; status?: string | number | null } | null) {
  if (!receipt) return { pending: true as const };
  if (!receiptSucceeded(receipt.status)) return { failed: true as const };
  const address = receipt.contractAddress || "";
  if (!ADDRESS_PATTERN.test(address)) return { pending: true as const };
  return { address };
}

export function bumpGasLimit(hex: string) {
  const value = BigInt(hex);
  return `0x${(value + value / 5n).toString(16)}`;
}

export function tokenDeployMessage(error: unknown, language: "es" | "en") {
  const es = language === "es";
  const code = typeof error === "object" && error && "code" in error ? Number((error as { code: unknown }).code) : 0;
  const raw = error instanceof Error ? error.message : String(error || "");
  const text = raw.toLowerCase();
  if (code === 4001 || text.includes("user rejected") || text.includes("rejected the request")) {
    return es ? "Cancelaste la transacción en MetaMask." : "You cancelled the transaction in MetaMask.";
  }
  if (code === -32002) {
    return es ? "Ya hay una solicitud abierta en MetaMask. Ábrela y confirma." : "A MetaMask request is already open. Open it and confirm.";
  }
  if (text.includes("insufficient funds") || text.includes("insufficient balance")) {
    return es ? "No hay ETH suficiente en Base para el gas. Recarga ETH en Base y vuelve a intentar." : "Not enough ETH on Base for gas. Add ETH on Base and try again.";
  }
  if (text.includes("no_metamask") || text.includes("no metamask")) {
    return es ? "Abre MetaMask en este navegador y conéctala. Una wallet solo en monitoreo no puede desplegar." : "Open MetaMask in this browser and connect it. A watch-only wallet cannot deploy.";
  }
  if (text.includes("deployment_not_confirmed")) {
    return es ? "Base todavía no confirmó el contrato. Espera y pulsa Continuar otra vez si MetaMask ya lo envió." : "Base has not confirmed the contract yet. Wait and tap Continue again if MetaMask already sent it.";
  }
  if (text.includes("deployment_record_failed") || text.includes("could not be verified")) {
    return es ? "El contrato se creó en Base, pero IRIS no pudo guardar la dirección. Vuelve a pulsar Continuar." : "The contract was created on Base, but IRIS could not save the address. Tap Continue again.";
  }
  if (text.includes("unauthorized") || text.includes("401") || text.includes("administrator")) {
    return es ? "Tu sesión de IRIS no permite guardar el contrato. Entra otra vez como administrador." : "Your IRIS session cannot save the contract. Sign in again as an administrator.";
  }
  return es ? "No se completó el despliegue. Abre MetaMask, confirma en Base y no cierres esta ventana." : "Deployment did not complete. Open MetaMask, confirm on Base, and keep this window open.";
}
