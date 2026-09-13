import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — BRO',
  description:
    'Privacy Policy for BRO, an AI assistant platform. Learn what data we collect, how we use it, and the rights you have.',
};

export default function PrivacyPolicyPage(): React.JSX.Element {
  return (
    <div className="container mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: September 13, 2026 · Service: BRO — AI Assistant Platform
      </p>

      <div className="mt-8 space-y-8 text-sm leading-6 text-muted-foreground">
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">1. Who we are</h2>
          <p>
            This Privacy Policy explains how BRO (&quot;BRO&quot;, &quot;we&quot;, &quot;us&quot;,
            or &quot;our&quot; — operator contact details are noted in Section 10) collects, uses,
            stores, and protects information when you use the BRO AI assistant platform (the
            &quot;Service&quot;), including its website, web application, chats, tools, memory,
            voice features, automations, and integrations.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">2. Information we collect</h2>
          <p>
            We collect information you provide directly and information generated through your use
            of the Service:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="text-foreground">Account information.</strong> When you register or
              sign in, we collect your email address, display name, and profile picture (avatar). If
              you sign in with Google, we receive the profile information you authorize (typically
              your name, email address, and profile photo) and a unique Google account identifier.
              Passwords are stored only as a one-way cryptographic hash (scrypt) and are never
              stored or readable in plaintext.
            </li>
            <li>
              <strong className="text-foreground">Authentication and session data.</strong> We issue
              access and refresh tokens to keep you signed in. On the web these tokens are stored in
              your browser&apos;s local storage. We also set a short-lived, HTTP-only OAuth state
              cookie during Google-based sign-in flows (see Section 6).
            </li>
            <li>
              <strong className="text-foreground">User content.</strong> The Service stores content
              you create or provide, including chat conversations and messages, memories and notes,
              automation rules, sales and lead records (including opportunities, offers, and lead
              information), notification preferences, and account settings.
            </li>
            <li>
              <strong className="text-foreground">Connected accounts and integrations.</strong> If
              you connect a third-party service (for example Google Calendar, Gmail, Drive, Docs,
              Sheets, Tasks, Contacts, Slides, GitHub, Slack, Discord, Notion, Dropbox, Zoom,
              ClickUp, or WhatsApp), we collect and store the credentials (such as OAuth access and
              refresh tokens) and account identifiers needed to provide the connection. In
              production, stored credentials and tokens are encrypted at rest using AES-256-GCM.
            </li>
            <li>
              <strong className="text-foreground">Usage and technical data.</strong> We process logs
              (including IP address), audit events, analytics summaries, integration health
              telemetry, and error reports to operate, secure, and improve the Service.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">3. How we use information</h2>
          <p>We use the information we collect to:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              Provide, maintain, and secure the Service, including authentication, chat, memory,
              voice, tools, and automation.
            </li>
            <li>
              Process your requests with artificial intelligence providers. When you use AI
              features, the prompts and content you submit may be transmitted to third-party AI
              processing providers (such as OpenAI or an OpenAI-compatible endpoint you or your
              administrator has configured, including models hosted by Google or NVIDIA) and to
              voice synthesis providers (such as ElevenLabs) to generate responses and audio.
            </li>
            <li>
              Operate connected third-party accounts, but only with your authorization and within
              the scopes you grant.
            </li>
            <li>
              Monitor and improve reliability, performance, and security, including detecting abuse
              and preventing fraud.
            </li>
            <li>Comply with applicable laws and respond to lawful requests.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">4. How we share information</h2>
          <p>
            We do not sell your personal data. We share information only in the following
            circumstances:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="text-foreground">AI and voice providers.</strong> Content you
              submit for AI processing is sent to the provider you (or your administrator) selected,
              as described in Section 3.
            </li>
            <li>
              <strong className="text-foreground">Third-party services you connect.</strong> When
              you authorize an integration, we exchange data with that service on your behalf using
              the permissions (scopes) you granted.
            </li>
            <li>
              <strong className="text-foreground">Service providers.</strong> We use hosting,
              database, caching, and infrastructure providers (for example cloud hosting and managed
              database services) that process data on our behalf under confidentiality obligations.
            </li>
            <li>
              <strong className="text-foreground">Legal requirements.</strong> We may disclose
              information where required by law, regulation, or legal process, or to protect our
              rights, safety, or property and that of our users.
            </li>
            <li>
              <strong className="text-foreground">Business transfers.</strong> In the event of a
              merger, acquisition, or sale of assets, your data may be transferred as part of that
              transaction.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">5. Legal bases for processing</h2>
          <p>
            Where the General Data Protection Regulation (GDPR) applies, we process personal data on
            the basis of: (a) performance of the contract with you to provide the Service; (b) our
            legitimate interests in operating, securing, and improving the Service; (c) your
            consent, where we rely on it (such as connecting an integration or using optional AI
            features) and which you may withdraw at any time; and (d) compliance with legal
            obligations.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">
            6. Cookies and similar technologies
          </h2>
          <p>
            The Service uses a short-lived, HTTP-only, SameSite=Lax cookie named{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">oauth_state</code>{' '}
            (prefixed{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">__Host-</code> in
            production) to protect the Google sign-in and OAuth flows against cross-site request
            forgery (CSRF). This cookie is set securely when the Service runs over HTTPS, does not
            store personal data, and expires automatically after a short period. We do not use
            advertising cookies or third-party trackers. You can configure your browser to block
            cookies; however, some sign-in features may not work without them.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">7. Data retention</h2>
          <p>
            We retain account information and user content for as long as your account is active and
            as needed to provide the Service. Audit and technical logs are retained for a limited
            period consistent with operational and security needs. If you delete your account or
            your data, we delete or anonymize the data we are not required to keep for legal,
            security, or fraud-prevention purposes. You may also disconnect any third-party
            integration at any time to revoke our access to that service.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">8. Your rights</h2>
          <p>
            Depending on your location, you may have rights to access, correct, export
            (portability), and delete your personal data, and to object to or restrict certain
            processing. You can exercise most of these directly in the Service (for example, editing
            your profile, disconnecting integrations, or deleting content). To exercise any other
            right, or to withdraw consent, contact us using the details in Section 10. If you
            believe your data has been processed in violation of applicable law, you may also lodge
            a complaint with the data protection authority in your country.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">9. Children</h2>
          <p>
            The Service is not directed to children. In the European Economic Area, the Service is
            not intended for anyone under 16; elsewhere, it is not intended for anyone under 13. We
            do not knowingly collect personal data from children. If you believe a child has
            provided us personal data, please contact us so we can delete it.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">10. Contact</h2>
          <p>
            If you have questions about this Privacy Policy or your data, contact us at:{' '}
            <span className="text-foreground">[Your contact email]</span>.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">
            11. International data transfers
          </h2>
          <p>
            Data may be processed by us and by our service providers in countries other than your
            own. Where we transfer personal data across borders, we rely on appropriate safeguards
            (such as standard contractual clauses) consistent with applicable law.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">12. Changes to this policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will post any changes on this
            page and update the &quot;Last updated&quot; date above. Material changes will be
            highlighted where reasonably possible. Your continued use of the Service after changes
            take effect constitutes acceptance of the revised policy.
          </p>
        </section>
      </div>
    </div>
  );
}
