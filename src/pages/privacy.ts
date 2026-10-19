/**
 * The app's privacy policy, served at /privacy so the store listing and the
 * app's Settings screen can link to it without separate hosting. Publisher
 * details come from the environment (APP_NAME, PUBLISHER_NAME, CONTACT_EMAIL).
 * Change POLICY_DATE whenever the text below changes.
 */
export const POLICY_DATE = '19 October 2026';

export interface PolicyDetails {
  appName: string;
  publisher: string;
  contactEmail: string;
  apiFootball: boolean;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function privacyPolicyHtml(d: PolicyDetails, host: string): string {
  const app = escape(d.appName);
  const publisher = escape(d.publisher);
  const contact = d.contactEmail ? `<a href="mailto:${escape(d.contactEmail)}">${escape(d.contactEmail)}</a>` : 'the contact address on our store listing';
  const providers = ['football-data.org', 'OpenLigaDB', ...(d.apiFootball ? ['API-Football'] : [])].join(', ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${app} privacy policy</title>
<style>
  :root { color-scheme: light dark; --bg: #F5F3EE; --text: #141413; --muted: #5C5850; --line: #E0DCD2; --accent: #4A6300; }
  @media (prefers-color-scheme: dark) { :root { --bg: #000; --text: #F2F1EC; --muted: #A3A3A8; --line: #242428; --accent: #C8F31D; } }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 680px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 28px; line-height: 1.2; margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 32px 0 8px; padding-top: 16px; border-top: 1px solid var(--line); }
  p, li { color: var(--text); }
  .muted { color: var(--muted); font-size: 14px; }
  a { color: var(--accent); }
  ul { padding-left: 20px; }
</style>
</head>
<body>
<main>
<h1>${app} privacy policy</h1>
<p class="muted">Last updated ${POLICY_DATE}</p>

<p>${app} ("the app") is published by ${publisher} ("we"). This policy explains what information the app handles and why. ${app} has no accounts, so we never ask for your name, email address or phone number.</p>

<h2>What stays on your phone</h2>
<p>Your pinned teams, competitions and matches, your reminder settings, your theme and time zone choice, and recently loaded fixtures (kept so the app works offline) are stored <strong>only on your device</strong>. We can't see them. Uninstalling the app, or clearing its storage, deletes them.</p>
<p>Match reminders are scheduled <strong>locally</strong> by your phone's operating system. They are not sent from our servers.</p>

<h2>What the app sends to our server</h2>
<p>To show fixtures, results and tables, the app requests data from our server at ${escape(host)}. Those requests contain:</p>
<ul>
  <li>the date, time zone and competitions you are viewing;</li>
  <li>the identifiers of the teams, competitions or matches you have pinned, so the server can return their fixtures. These are football identifiers, not information about you.</li>
</ul>
<p>As with any internet service, our server and its hosting provider (Vercel Inc.) receive your device's <strong>IP address</strong> and basic technical details with each request. We use the IP address only to protect the service from abuse (rate limiting): it is kept in a counter that expires within about two minutes. The hosting provider's request logs may keep it for a limited period under <a href="https://vercel.com/legal/privacy-policy">Vercel's privacy policy</a>. We don't use it to identify you, and we don't sell or share it.</p>
<p>Football data comes from third-party providers (${providers}). Our server contacts them; your device does not, and nothing about you is passed to them.</p>

<h2>Advertising</h2>
<p>The app shows a small number of banner ads through <strong>Google AdMob</strong>, a service of Google LLC. To serve and measure ads, Google may collect and use:</p>
<ul>
  <li>your device's advertising identifier;</li>
  <li>your IP address and the approximate location derived from it;</li>
  <li>information about your device;</li>
  <li>your interactions with ads.</li>
</ul>
<p>Where the law requires your consent (for example in the EEA, the UK and Switzerland), the app asks for it through Google's consent tool before any ad is requested. You can change your choice at any time in <strong>Settings → Privacy &amp; ad choices</strong>. If you don't consent, you may see non-personalised ads or none.</p>
<p>On iOS, the app asks for permission to track only if you haven't already decided; you can change this in iOS Settings → Privacy &amp; Security → Tracking. How Google uses this information: <a href="https://policies.google.com/technologies/partner-sites">policies.google.com/technologies/partner-sites</a>. You can reset or delete your advertising ID in your device settings.</p>

<h2>Notifications</h2>
<p>If you allow notifications, the app shows reminders before matches you pinned. You can turn them off in the app or in your device settings at any time.</p>

<h2>Children</h2>
<p>${app} is not directed at children under 13 (or the minimum age in your country) and does not knowingly collect their information.</p>

<h2>Your choices and rights</h2>
<ul>
  <li><strong>Pins, settings and saved data:</strong> unpin, clear the app's storage, or uninstall.</li>
  <li><strong>Advertising:</strong> use Settings → Privacy &amp; ad choices, or reset your advertising ID in your device settings.</li>
  <li><strong>Requests about data:</strong> we hold no account or profile about you, so there is usually nothing to look up. For any request or question, contact ${contact}.</li>
</ul>

<h2>Security</h2>
<p>All traffic between the app and our server is encrypted (HTTPS).</p>

<h2>Changes</h2>
<p>If this policy changes, we'll update the date above and, for significant changes, mention it in the app's release notes.</p>

<h2>Contact</h2>
<p>${publisher} · ${contact}</p>
</main>
</body>
</html>`;
}
