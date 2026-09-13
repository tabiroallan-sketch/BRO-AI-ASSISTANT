import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — BRO',
  description:
    'Terms of Service for BRO, an AI assistant platform. Read the rules for using the Service.',
};

export default function TermsOfServicePage(): React.JSX.Element {
  return (
    <div className="container mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: September 13, 2026 · Service: BRO — AI Assistant Platform
      </p>

      <div className="mt-8 space-y-8 text-sm leading-6 text-muted-foreground">
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">1. Acceptance of these terms</h2>
          <p>
            These Terms of Service (&quot;Terms&quot;) govern your access to and use of the BRO — AI
            Assistant Platform (the &quot;Service&quot;), operated by the entity identified in
            Section 12 (the &quot;Company&quot;, &quot;we&quot;, &quot;us&quot;, or
            &quot;our&quot;). By creating an account or using the Service, you agree to these Terms.
            If you do not agree, you may not use the Service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">2. Eligibility</h2>
          <p>
            You must be at least 13 years old (or 16 in the European Economic Area) to use the
            Service. If you are using the Service on behalf of an organization, you represent that
            you have authority to bind that organization to these Terms. Accounts are for individual
            human users unless a business arrangement with us provides otherwise.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">3. The Service</h2>
          <p>
            The Service provides an AI assistant that we host, including chat, memory, voice,
            browser and productivity tools, automations, analytics, and integrations with
            third-party services (such as Google Workspace, GitHub, Slack, Notion, Dropbox, Zoom,
            ClickUp, and others). You grant us the right to store and process the content you
            provide and the connections you authorize in order to operate the Service for you.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">4. Accounts and security</h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              You are responsible for safeguarding your credentials and for all activity that occurs
              under your account.
            </li>
            <li>
              You must provide accurate, current, and complete information and keep it up to date.
            </li>
            <li>Notify us promptly if you believe your account was compromised.</li>
            <li>
              We may suspend or close accounts that violate these Terms or that pose a security
              risk.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">5. Acceptable use</h2>
          <p>
            You agree not to misuse the Service. Prohibited conduct includes, without limitation:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Using the Service for any unlawful activity or in violation of applicable laws.</li>
            <li>
              Violating or attempting to circumvent the security, authentication, or rate-limiting
              controls of the Service.
            </li>
            <li>
              Interfering with or disrupting the Service, its infrastructure, or other users&apos;
              accounts or data.
            </li>
            <li>
              Accessing another person&apos;s account, or attempting to, without authorization.
            </li>
            <li>
              Uploading or transmitting malicious code, or using the Service to develop malware or
              conduct phishing, spam, or fraud.
            </li>
            <li>
              Implying affiliation with or endorsement by us, or misrepresenting the source of
              content.
            </li>
            <li>
              Scraping or systematically extracting data from the Service beyond your own account
              data without authorization.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">
            6. Third-party services and integrations
          </h2>
          <p>
            The Service can connect to third-party services. You are responsible for providing
            accurate credentials, understanding the permissions (scopes) you grant, and complying
            with the terms of those third-party services. When you connect an integration, we act on
            your behalf and only within the permissions you authorize. We are not responsible for
            the availability, content, or practices of third-party services, and your use of them is
            subject to their own terms and privacy policies. You may revoke any integration at any
            time from the Service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">7. AI-generated output</h2>
          <p>
            The Service uses artificial intelligence models to generate responses, drafts,
            summaries, and other outputs. These can be inaccurate, incomplete, or outdated, and may
            &quot;hallucinate&quot; facts. AI output does not constitute professional, legal,
            financial, medical, or other advice, and you are solely responsible for how you use it
            and for any decisions you make based on it. You should independently verify important
            information.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">
            8. Your content and intellectual property
          </h2>
          <p>
            You retain ownership of the content you submit to the Service. You grant us a worldwide,
            non-exclusive, royalty-free license to host, store, process, and display that content
            solely to provide the Service to you. If you provide feedback or suggestions, you grant
            us a perpetual license to use them to improve the Service. The Service itself, including
            its software, design, and branding, is our property or that of our licensors, and is
            protected by intellectual property laws.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">9. Fees</h2>
          <p>
            The Service is currently provided free of charge. We may introduce fees for features in
            the future; any such charges and payment terms will be presented to you before you incur
            them, and your continued use constitutes acceptance of those charges.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">10. Termination</h2>
          <p>
            You may stop using the Service and delete your account at any time. We may suspend or
            terminate your access at our discretion, including for violation of these Terms or if
            continued operation would create legal or security risk. Provisions of these Terms that
            by their nature should survive termination (such as intellectual property, disclaimers,
            limitation of liability, and governing law) will survive.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">
            11. Disclaimers and limitation of liability
          </h2>
          <p>
            The Service is provided &quot;as is&quot; and &quot;as available&quot; without
            warranties of any kind, whether express or implied, including merchantability, fitness
            for a particular purpose, and non-infringement. To the maximum extent permitted by law,
            the Company shall not be liable for indirect, incidental, special, consequential, or
            punitive damages, or for lost profits or data, arising out of or relating to the
            Service. The Company&apos;s total liability for any claims related to the Service shall
            not exceed the greater of the amounts you paid us in the twelve months preceding the
            claim or one hundred dollars (US$100).
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">12. Contact</h2>
          <p>
            Questions about these Terms may be sent to:{' '}
            <span className="text-foreground">[Your contact email]</span>.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">13. Changes to these terms</h2>
          <p>
            We may revise these Terms from time to time. We will post changes on this page and
            update the &quot;Last updated&quot; date above. For material changes, we will make
            reasonable efforts to notify you. Continued use of the Service after changes take effect
            constitutes your acceptance of the revised Terms.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">14. Governing law and disputes</h2>
          <p>
            These Terms are governed by the laws applicable in the jurisdiction where the Company is
            established, without regard to conflict-of-law principles. Any dispute arising out of
            these Terms will be subject to the exclusive jurisdiction of the competent courts in
            that jurisdiction, and you consent to that jurisdiction. Where applicable law requires
            mandatory protections, nothing in these Terms limits or excludes them.
          </p>
        </section>
      </div>
    </div>
  );
}
