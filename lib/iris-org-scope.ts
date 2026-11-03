/**
 * IRIS — alcance por organización para datos que hoy se guardan por email.
 *
 * Problema que cierra (parcialmente, sin migración destructiva): los
 * escritorios de Creator/Misión/Memoria ya se guardan por organizationId,
 * pero dispositivos, alertas, wallet y compras se guardaban por email, de
 * modo que cambiar de organización no cambiaba esos datos.
 *
 * Modelo sin migración de esquema (documentado como pendiente):
 *   - Un dispositivo/alerta pertenece a la organización si su ownerEmail
 *     es miembro de esa organización. Sin lista de miembros (o sin
 *     contexto de org), se conserva el comportamiento anterior: solo los
 *     datos del propio email. Nada se borra ni se reasigna en silencio.
 *   - Wallet y compras se leen primero por clave de organización y luego
 *     por la clave legada por email (lectura retrocompatible); se escriben
 *     por clave de organización cuando hay contexto de org, y por email
 *     cuando no lo hay. Las filas legadas quedan legibles, no se migran
 *     en esta entrega: la migración completa de esquema (columna
 *     organization_id en devices/security_alerts + backfill) sigue
 *     pendiente y debe hacerse con su propia revisión, no aquí.
 *   - Excepción documentada: el rol global ADMIN de plataforma sigue
 *     viendo todos los dispositivos, como ya hacía security-state. Es un
 *     rol de plataforma, no un miembro de organización; los ADMIN de
 *     organización solo ven su propia organización.
 */

import { orgDeskKey } from "./iris-tenant-core.ts";

export const WALLET_BASE_KEY = "iris_local_wallet_session";
export const PURCHASE_BASE_KEY = "iris_purchase_desk";

export function walletOrgKey(organizationId: string): string {
  return `${WALLET_BASE_KEY}:org:${organizationId}`;
}

export function walletLegacyKey(email: string): string {
  return `${WALLET_BASE_KEY}:${email.trim().toLowerCase()}`;
}

/** Purchase desk keys: la clave de org ya existe en iris-tenant-core. */
export function purchaseOrgKey(organizationId: string): string {
  return orgDeskKey("purchase", organizationId);
}

export function purchaseLegacyKey(email: string): string {
  return `${PURCHASE_BASE_KEY}:${email.trim().toLowerCase()}`;
}

/** Claves en orden de lectura: primero org, luego legada por email. */
export function scopedReadKeys(input: {
  organizationId?: string | null;
  email: string;
  base: "wallet" | "purchase";
}): string[] {
  const legacy = input.base === "wallet"
    ? walletLegacyKey(input.email)
    : purchaseLegacyKey(input.email);
  if (!input.organizationId) return [legacy];
  const org = input.base === "wallet"
    ? walletOrgKey(input.organizationId)
    : purchaseOrgKey(input.organizationId);
  return org === legacy ? [org] : [org, legacy];
}

/** Clave de escritura: org cuando hay contexto, legada cuando no. */
export function scopedWriteKey(input: {
  organizationId?: string | null;
  email: string;
  base: "wallet" | "purchase";
}): string {
  return scopedReadKeys(input)[0];
}

export type OrgScopedRow = { ownerEmail?: string | null };

/**
 * Filtra filas visibles para el actor. memberEmails es la lista de
 * miembros ACTIVOS de la organización del actor (o null si no se pudo
 * resolver). Con memberEmails, solo filas de miembros; sin ella, solo
 * filas del propio email (comportamiento anterior). El ADMIN global de
 * plataforma es la única excepción y debe pasarse explícitamente.
 */
export function filterOrgScopedRows<T extends OrgScopedRow>(
  rows: T[],
  input: {
    actorEmail: string;
    memberEmails?: string[] | null;
    isGlobalAdmin?: boolean;
  },
): T[] {
  if (input.isGlobalAdmin) return rows;
  const actor = input.actorEmail.trim().toLowerCase();
  if (input.memberEmails && input.memberEmails.length) {
    const members = new Set(input.memberEmails.map(email => email.trim().toLowerCase()));
    return rows.filter(row => members.has(String(row.ownerEmail || "").trim().toLowerCase()));
  }
  return rows.filter(row => String(row.ownerEmail || "").trim().toLowerCase() === actor);
}

export function canAccessOrgScopedRow(
  row: OrgScopedRow | null | undefined,
  input: {
    actorEmail: string;
    memberEmails?: string[] | null;
    isGlobalAdmin?: boolean;
  },
): boolean {
  if (!row) return false;
  return filterOrgScopedRows([row], input).length === 1;
}
