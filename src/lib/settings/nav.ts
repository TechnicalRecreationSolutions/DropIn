import { can } from "@/lib/auth/roles";
import type { Actor } from "@/lib/auth/roles";
import type { Permission } from "@/lib/auth/roles";

/**
 * Every settings destination, in one list, with the permission that decides
 * whether it exists.
 *
 * ## Why this is a module and not an array inside the layout
 *
 * Three things need the same answer and must not disagree: the rail inside
 * `/dashboard/settings`, the expandable group in the sidebar, and
 * `scripts/verify/verify-bc.mjs`, which walks every href as four different
 * roles. When the sidebar kept its own copy, adding a settings page meant
 * remembering to add it in two places — and the failure mode was a page that
 * existed but could not be found, which is indistinguishable from a page that
 * was never built.
 *
 * ## Items are removed, never greyed out
 *
 * The rule `SidebarMenu` already follows. A disabled "Billing" row invites an
 * aux staffer to wonder what is behind it, and every page added later would
 * have to remember to disable itself.
 *
 * ## `Your account` has no permission, on purpose
 *
 * It is the one item every role reaches, aux included — it is where somebody
 * changes their own password, and a person who cannot change their password is
 * a person whose leaked password stays valid. It is also the reason the
 * Settings section as a whole is offered to every role rather than gated on
 * `org:edit-settings`: an aux staffer opening Settings finds exactly one page,
 * which is correct, and finds it rather than being told the section is not
 * theirs.
 */
export interface SettingsNavItem {
  href: string;
  label: string;
  /** One line under the label in the rail. Not repeated as a page subtitle. */
  blurb: string;
  /** Omitted means every role, aux included. */
  permission?: Permission;
  /** The index route, which every other settings path starts with. */
  exact?: boolean;
}

export interface SettingsNavGroup {
  /** Rail heading. Absent from the mobile tab strip, which has no room. */
  title: string;
  items: SettingsNavItem[];
}

export const SETTINGS_ROOT = "/dashboard/settings";

/**
 * The full catalogue, unfiltered. Order is the order it renders in, and it is
 * deliberate: the things a new organization sets up on day one come first, the
 * thing that ends it comes last.
 */
export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    title: "Organization",
    items: [
      {
        href: "/dashboard/settings",
        label: "General",
        blurb: "Name, logo and description",
        permission: "org:edit-settings",
        exact: true,
      },
      {
        href: "/dashboard/settings/contact",
        label: "Contact & location",
        blurb: "How the public reaches you",
        permission: "org:edit-settings",
      },
      {
        href: "/dashboard/settings/public",
        label: "Public presence",
        blurb: "What patrons can see today",
        permission: "facility:edit",
      },
    ],
  },
  {
    title: "People",
    items: [
      {
        href: "/dashboard/settings/staff",
        label: "Staff",
        blurb: "Who can sign in, and what they change",
        permission: "staff:view",
      },
      {
        href: "/dashboard/settings/permissions",
        label: "Permissions",
        blurb: "What each role is allowed to do",
        permission: "org:edit-settings",
      },
    ],
  },
  {
    title: "Data",
    items: [
      {
        href: "/dashboard/settings/data-sources",
        label: "Data sources",
        blurb: "Everything imported into Dropin",
        permission: "import:use",
      },
    ],
  },
  {
    title: "Account",
    items: [
      {
        href: "/dashboard/settings/account",
        label: "Your account",
        blurb: "Your sign-in, and this device",
      },
      {
        href: "/dashboard/settings/billing",
        label: "Billing",
        blurb: "Plan, invoices and payment",
        permission: "billing:manage",
      },
    ],
  },
  {
    title: "Advanced",
    items: [
      {
        href: "/dashboard/settings/danger",
        label: "Danger zone",
        blurb: "Hand over or close the organization",
        permission: "org:transfer-ownership",
      },
    ],
  },
];

/**
 * The groups this actor may see, with empty groups dropped.
 *
 * Permissions are asked WITHOUT a department, so a coordinator answers false
 * for anything scoped — which is right here, because every settings permission
 * in this file is an org-wide one. Nothing in this section is per-department.
 *
 * `actor` may be null during the prerendered shell pass, before the org
 * context resolves. That is not "no permissions": rendering an empty rail and
 * then filling it in shifts the whole page, so a null actor gets the full
 * catalogue and the per-page guard does the real refusing.
 */
export function visibleSettingsNav(actor: Actor | null): SettingsNavGroup[] {
  return SETTINGS_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || !actor || can(actor, item.permission)),
  })).filter((group) => group.items.length > 0);
}

/** Flat, in rail order — what the sidebar's expandable group renders. */
export function visibleSettingsItems(actor: Actor | null): SettingsNavItem[] {
  return visibleSettingsNav(actor).flatMap((group) => group.items);
}
