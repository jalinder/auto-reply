import { LegalPage } from '@/components/legal';

export const metadata = { title: 'Terms of service — Relay' };

/* TEMPLATE: replace bracketed details and have it reviewed by counsel before launch. */
export default function Terms() {
  return (
    <LegalPage title="Terms of service" updated="[date]">
      <p>These terms are an agreement between you and [Company legal name] for using Relay. By creating an account you accept them on behalf of yourself and your business.</p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Only message people who agreed to hear from your business, and record where that consent came from.</li>
        <li>Honour opt-outs immediately. Relay blocks opted-out numbers, but you’re responsible for the lists you upload.</li>
        <li>Don’t send spam, illegal or misleading content, or anything that infringes others’ rights.</li>
        <li>Keep your password private and remove teammates who no longer need access.</li>
      </ul>

      <h2>WhatsApp linking</h2>
      <p>Relay sends messages through a WhatsApp number you link, the same way WhatsApp Web does. WhatsApp sets its own rules and may limit, restrict or ban numbers, including for automated or bulk sending. You link numbers at your own risk, and we aren’t responsible for actions WhatsApp takes on your account. We don’t guarantee delivery; reports show only what WhatsApp confirms.</p>

      <h2>Plans and billing</h2>
      <p>Paid plans renew monthly until cancelled. Cancellation takes effect at the end of the billing period. Fees are non-refundable except where the law requires. Prices exclude applicable taxes.</p>

      <h2>Your data</h2>
      <p>You own the contacts and content you upload. You give us permission to process it only to provide the service, as described in our <a href="/privacy">privacy notice</a>.</p>

      <h2>Suspension</h2>
      <p>We may suspend accounts that break these terms, put other users at risk, or don’t pay, and will tell you why when we can.</p>

      <h2>Liability</h2>
      <p>The service is provided “as is”. To the extent the law allows, our total liability is limited to the fees you paid in the [12] months before the claim.</p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of India. Courts in [city] have exclusive jurisdiction.</p>

      <h2>Contact</h2>
      <p>[support email] · [postal address]</p>
    </LegalPage>
  );
}
