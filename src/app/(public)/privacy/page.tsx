import type { Metadata } from "next";
import Link from "next/link";
import LegalDocument, { Placeholder } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
  // Root layout applies the "%s | Dropin" template — no suffix here.
  title: "Privacy Policy",
  description:
    "What personal information Dropin collects, why, who it is shared with, and how to exercise your rights over it.",
};

/**
 * /privacy
 *
 * Drafted from the actual schema and code, not from a template: the data
 * inventory below matches `001_initial_schema.sql` and `005_analytics_tables.sql`,
 * and the processor list matches the origins allowed in the CSP. If either
 * changes, this page is wrong until it is updated too.
 *
 * Needs review by a qualified lawyer before launch — the highlighted
 * placeholders are the facts only the operator can supply.
 */
export default function PrivacyPage() {
  return (
    <LegalDocument title="Privacy Policy" lastUpdated="7 August 2026">
      <p>
        This policy explains what personal information{" "}
        <Placeholder>legal entity name</Placeholder> (&ldquo;Dropin&rdquo;,
        &ldquo;we&rdquo;) collects when you use our website and embedded
        schedule widget, why we collect it, and what you can do about it.
      </p>

      <h2>Who this applies to</h2>
      <p>Dropin has two kinds of user, and we treat them differently:</p>
      <ul>
        <li>
          <strong>Visitors</strong> browsing schedules on our site or through a
          widget embedded on a recreation provider&rsquo;s website. You do not
          need an account, and we do not ask you for any personal information.
        </li>
        <li>
          <strong>Organization staff</strong> who create an account to publish
          their facility&rsquo;s schedules. You give us an email address, and we
          store the information you enter about your organization.
        </li>
      </ul>

      <h2>What we collect</h2>

      <h3>If you create an account</h3>
      <ul>
        <li>
          <strong>Email address and password.</strong> Authentication is handled
          by Supabase. Your password is stored only as a salted hash — we never
          see or store the password itself.
        </li>
        <li>
          <strong>Organization profile.</strong> Name, description, logo,
          website, phone, email, and postal address — whatever you choose to
          enter. This is business contact information intended to be shown
          publicly on your facility&rsquo;s page.
        </li>
        <li>
          <strong>Staff invitations.</strong> If you invite a colleague, we
          store the email address you entered until the invitation is accepted
          or revoked.
        </li>
        <li>
          <strong>Schedule content.</strong> Facilities, spaces, programs and
          sessions you publish. This is public by design.
        </li>
        <li>
          <strong>Billing status.</strong> Your Stripe customer identifier, plan
          and subscription state. Card numbers are handled entirely by Stripe
          and never reach our servers or database.
        </li>
      </ul>

      <h3>If you are just browsing</h3>
      <p>
        We record aggregate usage events — a widget being loaded, a program
        being clicked, a facility page being viewed — so that providers can see
        whether their listings are working. Each event stores the event type,
        the facility or program involved, the referring page, your browser&rsquo;s
        user-agent string, and a timestamp.
      </p>
      <p>
        <strong>We do not store IP addresses.</strong> Your IP address is
        combined with a secret salt that rotates daily and then hashed with
        SHA-256; only that hash is written. Because the salt changes every day,
        yesterday&rsquo;s hash cannot be matched to today&rsquo;s, so these
        events cannot be linked into a profile of you over time, and the
        original address cannot be recovered from them.
      </p>

      <h2>Cookies</h2>
      <p>
        Dropin sets cookies only to keep you signed in. There are no
        advertising, profiling or third-party tracking cookies, no tracking
        pixels, and nothing stored in your browser&rsquo;s local storage. The
        analytics described above run server-side and do not set a cookie.
      </p>
      <p>
        Because our cookies are strictly necessary to provide a service you
        asked for, most privacy laws do not require us to obtain consent for
        them, and we do not show a consent banner. If you block them you will be
        unable to sign in, but browsing public schedules will still work.
      </p>

      <h2>Who we share it with</h2>
      <p>
        We do not sell personal information, and we do not share it for
        advertising. We use these service providers to operate Dropin:
      </p>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Purpose</th>
            <th>Data involved</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Supabase</td>
            <td>Database, authentication, file storage</td>
            <td>All account and content data</td>
          </tr>
          <tr>
            <td>Stripe</td>
            <td>Subscription payments</td>
            <td>Billing contact and card details, held by Stripe</td>
          </tr>
          <tr>
            <td>Vercel</td>
            <td>Application hosting</td>
            <td>Request logs</td>
          </tr>
          <tr>
            <td><Placeholder>email provider</Placeholder></td>
            <td>Account confirmation and invitation emails</td>
            <td>Recipient email address</td>
          </tr>
        </tbody>
      </table>
      <p>
        We may also disclose information where the law requires it, or to
        protect our rights or the safety of others.
      </p>

      <h2>Where your data is held</h2>
      <p>
        Our database is hosted in <Placeholder>region</Placeholder>. Some
        providers listed above operate internationally, so your information may
        be processed outside your country, including in the United States.
        Where required, these transfers rely on the providers&rsquo; standard
        contractual clauses.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>
          <strong>Account and organization data</strong> — for as long as the
          account is open, then deleted within{" "}
          <Placeholder>30</Placeholder> days of a deletion request.
        </li>
        <li>
          <strong>Analytics events</strong> — retained for{" "}
          <Placeholder>12 months</Placeholder>, then deleted. These are already
          non-identifying.
        </li>
        <li>
          <strong>Billing records</strong> — kept as long as tax and accounting
          law requires, typically seven years.
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Depending on where you live — under Canada&rsquo;s PIPEDA, the EU/UK
        GDPR, or California&rsquo;s CCPA/CPRA — you have some or all of the
        following rights:
      </p>
      <ul>
        <li>Ask what personal information we hold about you, and get a copy.</li>
        <li>Have inaccurate information corrected.</li>
        <li>Have your information deleted.</li>
        <li>Receive your data in a portable, machine-readable format.</li>
        <li>Object to or restrict certain processing.</li>
        <li>
          Withdraw consent where we relied on it, without affecting what we did
          before you withdrew it.
        </li>
      </ul>
      <p>
        California residents: we do not sell or share personal information as
        those terms are defined by the CCPA, and we will not discriminate
        against you for exercising any right.
      </p>
      <p>
        To exercise any of these, email us at{" "}
        <Placeholder>privacy@yourdomain</Placeholder>. We respond within{" "}
        <Placeholder>30</Placeholder> days. If you are unhappy with our
        response you may complain to your local data protection authority — in
        Canada, the Office of the Privacy Commissioner.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit with HTTPS and encrypted at rest by our
        database provider. Access to each organization&rsquo;s data is enforced
        at the database level, so one organization cannot read another&rsquo;s.
        Passwords are hashed, IP addresses are hashed with a rotating salt, and
        administrative access is limited to those who need it.
      </p>
      <p>
        No system is perfectly secure. If we discover a breach affecting your
        personal information, we will notify you and the relevant regulator as
        the law requires.
      </p>

      <h2>Children</h2>
      <p>
        Dropin is intended for recreation providers and adults browsing
        schedules. We do not knowingly collect personal information from
        children under <Placeholder>13</Placeholder>. If you believe a child has
        given us information, contact us and we will delete it.
      </p>

      <h2>Changes</h2>
      <p>
        If we change this policy we will update the date at the top, and for
        significant changes we will tell account holders by email before the
        change takes effect.
      </p>

      <h2>Contact</h2>
      <p>
        <Placeholder>legal entity name</Placeholder>
        <br />
        <Placeholder>postal address</Placeholder>
        <br />
        <Placeholder>privacy@yourdomain</Placeholder>
      </p>

      <p className="pt-4 text-sm text-muted-foreground">
        See also our <Link href="/terms">Terms of Service</Link>.
      </p>
    </LegalDocument>
  );
}
