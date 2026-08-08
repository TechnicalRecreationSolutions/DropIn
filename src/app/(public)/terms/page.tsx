import type { Metadata } from "next";
import Link from "next/link";
import LegalDocument, { Placeholder } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
  // Root layout applies the "%s | Dropin" template — no suffix here.
  title: "Terms of Service",
  description:
    "The terms that govern use of Dropin by recreation providers and by visitors browsing schedules.",
};

/**
 * /terms
 *
 * Describes the product as actually built — subscription billing through
 * Stripe, org-scoped staff roles, the embeddable widget, and the fact that
 * schedule accuracy is the provider's responsibility rather than ours.
 *
 * Needs review by a qualified lawyer before launch. The liability, indemnity
 * and governing-law sections in particular are the ones a lawyer will want to
 * set for your jurisdiction.
 */
export default function TermsPage() {
  return (
    <LegalDocument title="Terms of Service" lastUpdated="7 August 2026">
      <p>
        These terms are an agreement between you and{" "}
        <Placeholder>legal entity name</Placeholder> (&ldquo;Dropin&rdquo;,
        &ldquo;we&rdquo;). By creating an account or using the service you agree
        to them. If you are agreeing on behalf of an organization, you confirm
        you are authorised to bind that organization.
      </p>

      <h2>What Dropin does</h2>
      <p>
        Dropin lets recreation providers publish drop-in schedules, and lets the
        public find them — on our website or through a widget a provider embeds
        on their own site. We provide the platform. We do not run the programs,
        own the facilities, or take bookings.
      </p>

      <h2>Accounts</h2>
      <ul>
        <li>
          You must give accurate registration information and keep it current.
        </li>
        <li>
          You are responsible for activity under your account and for keeping
          your password confidential. Tell us promptly if you suspect
          unauthorised access.
        </li>
        <li>
          Accounts are for staff of the organization they belong to. Within an
          organization, owners and administrators can manage facilities,
          programs and staff; members can edit schedules. Granting someone
          access is your decision and your responsibility.
        </li>
        <li>
          You must be old enough to enter a binding contract where you live.
        </li>
      </ul>

      <h2>Your content</h2>
      <p>
        Schedules, facility details, logos and images you upload remain yours.
        You grant us a non-exclusive, worldwide, royalty-free licence to host,
        reproduce and display that content for the purpose of operating and
        promoting the service — including displaying it publicly and inside
        widgets embedded on third-party sites, which is the point of the
        product.
      </p>
      <p>You are responsible for making sure your content:</p>
      <ul>
        <li>is accurate, and kept up to date;</li>
        <li>
          is yours to publish, or that you have permission to publish it —
          including any images of people; and
        </li>
        <li>
          is not unlawful, misleading, infringing, or otherwise something we
          would have to remove.
        </li>
      </ul>
      <p>
        We may remove content that breaches these terms. We do not routinely
        review what you publish.
      </p>

      <h2>Schedule accuracy</h2>
      <p>
        <strong>
          Schedules are supplied by providers, not verified by us.
        </strong>{" "}
        Times change, pools close, programs get cancelled. Before travelling to
        a facility, confirm with the provider directly. We are not responsible
        for a wasted trip, and providers are responsible for the accuracy of
        what they publish.
      </p>

      <h2>Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>
          scrape, crawl or bulk-download the service except as any published API
          or embed allows;
        </li>
        <li>
          probe, disrupt or attempt to gain unauthorised access to the service,
          other accounts, or the underlying infrastructure;
        </li>
        <li>upload malware, or content that infringes or is unlawful;</li>
        <li>
          resell or sublicense access to the service without our written
          agreement;
        </li>
        <li>
          use the service to send unsolicited messages, or to impersonate
          another organization.
        </li>
      </ul>

      <h2>Subscriptions and payment</h2>
      <ul>
        <li>
          Paid plans are billed in advance on a recurring basis through Stripe.
          By subscribing you authorise those recurring charges.
        </li>
        <li>
          Fees are stated at checkout and exclude taxes unless said otherwise.
        </li>
        <li>
          You can cancel at any time from your billing settings. Cancellation
          takes effect at the end of the period you have already paid for, and
          that period is not refunded except where the law requires it.
        </li>
        <li>
          We may change prices with at least{" "}
          <Placeholder>30</Placeholder> days&rsquo; notice by email. Continuing
          to use a paid plan after that means you accept the new price.
        </li>
        <li>
          If payment fails we may suspend paid features until it is resolved.
        </li>
      </ul>

      <h2>The embeddable widget</h2>
      <p>
        You may embed the widget on websites your organization controls, to
        display your own schedules. Do not modify the embed code to misrepresent
        the source of the data, and do not use it to display another
        organization&rsquo;s content as your own.
      </p>

      <h2>Availability</h2>
      <p>
        We aim to keep Dropin available but do not promise uninterrupted
        service. We may change, suspend or discontinue features, and will give
        reasonable notice of material changes to paid features where we can. The
        service is provided <strong>as is</strong>, without warranties of any
        kind, to the fullest extent the law allows.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, we are not liable for indirect,
        incidental, special or consequential loss, or for lost profits, revenue,
        data or goodwill. Our total liability for any claim relating to the
        service is limited to the greater of the amount you paid us in the{" "}
        <Placeholder>12</Placeholder> months before the claim, or{" "}
        <Placeholder>CAD $100</Placeholder>.
      </p>
      <p>
        Nothing here excludes liability that cannot legally be excluded,
        including for death or personal injury caused by negligence, or fraud.
        Some jurisdictions do not allow certain exclusions, so parts of this
        section may not apply to you.
      </p>

      <h2>Indemnity</h2>
      <p>
        You agree to indemnify us against claims, losses and reasonable legal
        costs arising from your content, your use of the service, or your breach
        of these terms.
      </p>

      <h2>Suspension and termination</h2>
      <p>
        You may stop using Dropin and close your account at any time. We may
        suspend or terminate an account that breaches these terms, that creates
        legal risk, or that is being used to harm the service or other users —
        with notice where it is practical to give it. On termination your right
        to use the service ends; sections that by their nature should survive
        (content licence for material already published, liability, indemnity,
        governing law) do survive.
      </p>

      <h2>Privacy</h2>
      <p>
        Our <Link href="/privacy">Privacy Policy</Link> explains what we collect
        and why, and forms part of these terms.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        We may update these terms. We will change the date at the top, and for
        material changes we will notify account holders by email before they
        take effect. Continuing to use the service afterwards means you accept
        the update.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of{" "}
        <Placeholder>province/state and country</Placeholder>, and the courts of{" "}
        <Placeholder>jurisdiction</Placeholder> have exclusive jurisdiction,
        without affecting any mandatory consumer protections available where you
        live.
      </p>

      <h2>Contact</h2>
      <p>
        <Placeholder>legal entity name</Placeholder>
        <br />
        <Placeholder>postal address</Placeholder>
        <br />
        <Placeholder>legal@yourdomain</Placeholder>
      </p>
    </LegalDocument>
  );
}
