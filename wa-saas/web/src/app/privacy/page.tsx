import { LegalPage } from '@/components/legal';

export const metadata = { title: 'Privacy notice — Relay' };

/* TEMPLATE: replace bracketed details and have it reviewed by counsel before launch (blueprint §12). */
export default function Privacy() {
  return (
    <LegalPage title="Privacy notice" updated="[date]">
      <p>[Company legal name] (“we”) operates Relay. This notice explains what personal data we process, why, and your choices. It covers people who use Relay (our customers and their teams) and people whose details our customers upload (their contacts).</p>

      <h2>Who is responsible</h2>
      <p>For account and billing data, we are the data fiduciary. For contact lists and messages, the business that uses Relay decides why and how they’re used; we process that data on their instructions. Contacts should direct requests to that business first.</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account data:</strong> name, work email, password (stored only as a one-way hash), workspace and role.</li>
        <li><strong>Contact data uploaded by customers:</strong> phone numbers, names, tags, custom fields, consent records and opt-out requests.</li>
        <li><strong>Messages:</strong> campaign content, attachments, and delivery status (accepted, delivered, read, failed).</li>
        <li><strong>Linked WhatsApp sessions:</strong> an encrypted browser session for each linked number. We never ask for or store your WhatsApp two-step verification PIN.</li>
        <li><strong>Technical data:</strong> IP address, device and log data used for security and troubleshooting.</li>
        <li><strong>Billing:</strong> handled by our payment provider (Razorpay). We don’t store card details.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To provide the service: sending the messages our customers schedule and reporting outcomes.</li>
        <li>To keep accounts secure, prevent abuse, and honour opt-outs.</li>
        <li>To bill for subscriptions and meet legal obligations.</li>
      </ul>
      <p>We don’t sell personal data or use contact lists for our own marketing.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Message text: [90] days. Delivery history: [400] days. Activity logs: [2] years.</li>
        <li>Imported spreadsheets: 7 days. Campaign attachments: 180 days unless still in use.</li>
        <li>Deleted workspaces are erased after [30] days. Deleted contacts are anonymized immediately.</li>
      </ul>

      <h2>Sharing</h2>
      <p>We use processors for hosting, storage, email and payments, under contracts that require them to protect the data. Messages are delivered through WhatsApp, which handles them under its own terms. We disclose data to authorities only when the law requires it.</p>

      <h2>Your rights</h2>
      <p>Under India’s Digital Personal Data Protection Act, 2023 and other applicable laws, you can ask to access, correct or erase your data, withdraw consent, and nominate someone to act for you. To stop receiving WhatsApp messages from a business, reply STOP. Account holders can export contacts and delete their account in Settings.</p>

      <h2>Security</h2>
      <p>Data is encrypted in transit and at rest. Workspaces are isolated from each other, and sensitive actions require re-entering your password.</p>

      <h2>Contact and grievances</h2>
      <p>Grievance officer: [name], [email], [postal address]. We respond within [7] days. You may also contact the Data Protection Board of India.</p>
    </LegalPage>
  );
}
