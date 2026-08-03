"use server";

import { revalidatePath } from "next/cache";
import { requireChatGPTUser } from "../../chatgpt-auth";
import { provisionIrisUser, updateUserAccess } from "../../../lib/authz";

export type AccessActionState = { ok: boolean; message: string };

export async function changeUserAccess(_previous: AccessActionState, formData: FormData): Promise<AccessActionState> {
  try {
    const identity = await requireChatGPTUser("/admin/users");
    const actor = await provisionIrisUser(identity);
    const targetEmail = String(formData.get("targetEmail") || "");
    const role = String(formData.get("role") || "USER");
    const status = String(formData.get("status") || "ACTIVE");
    if (!targetEmail || !["ADMIN", "USER"].includes(role) || !["ACTIVE", "SUSPENDED"].includes(status)) throw new Error("Invalid access update");
    await updateUserAccess(actor.email, actor.role, targetEmail, role as "ADMIN" | "USER", status as "ACTIVE" | "SUSPENDED");
    revalidatePath("/admin/users");
    revalidatePath("/dashboard");
    return { ok: true, message: `Access updated for ${targetEmail}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Unable to update access" };
  }
}
