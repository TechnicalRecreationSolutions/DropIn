import { ROLE_LABELS } from "@/lib/auth/roles";
import type { InvitableRole } from "@/types/app.types";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export type InvitationEmailInput = {
  to: string;
  orgName: string;
  role: InvitableRole;
  token: string;
  /** The person sending it, so the recipient knows why this landed. */
  inviterEmail: string | null;
};

export type SendResult =
  | { ok: true }
  | { ok: false; reason: "not-configured" | "send-failed" };

/**
 * Sends a staff invitation.
 *
 * ## This is not the mail that will bite you
 *
 * This message goes through **Resend**, our own sender, and is not meaningfully
 * rate limited. What the invitee has to do next is: create an account — and
 * *that* confirmation email goes through **Supabase's built-in mailer**, which
 * allows roughly **two sends per hour** and then fails silently.
 *
 * So onboarding a shift's worth of staff will stall on the third person until
 * custom SMTP is configured (Supabase dashboard → Project Settings → Auth →
 * SMTP). That is launch blocker 1 in docs/RESUME.md and no code here can fix
 * it. The one mitigation that helps is below: the link carries the token
 * *through* signup, so a new staff member costs exactly one Supabase email
 * rather than two round trips, and an invitee who already has an account costs
 * none at all.
 *
 * ## Never throws
 *
 * The invitation row is already committed by the time this runs. Throwing here
 * would fail the request after the invitation exists, and a retry would then
 * create a second one. The caller reports a failed send as "invitation created,
 * copy the link" instead, which is honest and recoverable — the link in the
 * staff list works whether or not the mail arrived.
 */
export async function sendInvitationEmail(
  input: InvitationEmailInput
): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  // Neither is in .env.local today — `resend` appears in exactly one other
  // file (the Stripe webhook). Missing config is a deployment state, not an
  // error: the UI falls back to "copy this link and send it yourself".
  if (!apiKey || !from) return { ok: false, reason: "not-configured" };

  const url = invitationUrl(input.token);
  const roleLabel = ROLE_LABELS[input.role];
  const from_ = input.inviterEmail ? ` by ${input.inviterEmail}` : "";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: `You've been added to ${input.orgName} on Dropin`,
        text: [
          `You've been invited${from_} to join ${input.orgName} on Dropin as ${article(roleLabel)} ${roleLabel}.`,
          ``,
          `Accept the invitation:`,
          url,
          ``,
          `This link expires in 7 days and can only be used once, by this email address.`,
          `If you weren't expecting this, you can ignore it — nothing happens until you accept.`,
        ].join("\n"),
      }),
    });

    return res.ok ? { ok: true } : { ok: false, reason: "send-failed" };
  } catch {
    return { ok: false, reason: "send-failed" };
  }
}

/**
 * The link that goes in the email.
 *
 * `/invite/<token>` is public — the proxy only guards `/dashboard` and
 * `/admin` — so a signed-out invitee reaches the accept screen, which then
 * sends them through signup with `?next=/invite/<token>` so they land back
 * here afterwards. One Supabase email for the whole journey.
 */
export function invitationUrl(token: string): string {
  return `${APP_URL}/invite/${token}`;
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}
