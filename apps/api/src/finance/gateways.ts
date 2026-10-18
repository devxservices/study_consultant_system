import { createHmac, timingSafeEqual } from 'node:crypto';

/*
 * Payment gateways, behind one small seam.
 *
 * stripe: Stripe Checkout through its REST API - the consultancy's own
 *   account (its secret key, sealed at rest). The student pays on Stripe's
 *   page; Stripe tells us by a signed webhook, and only that records money.
 * test: a simulated provider for development and demos - the "checkout" is
 *   a page in this app with Pay and Cancel buttons. Refused in production.
 *
 * JazzCash and Easypaisa merchant APIs would be further drivers here; until
 * a consultancy has merchant credentials, wallet payments come in as proof
 * of payment, which works the same for the student.
 */

export interface CheckoutRequest {
  amount: number;
  currency: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  /** Ours: the online payment's id, echoed back by the provider. */
  reference: string;
  customerEmail?: string | null;
}

export interface CheckoutSession {
  providerRef: string;
  url: string;
}

export async function stripeCheckout(secretKey: string, req: CheckoutRequest): Promise<CheckoutSession> {
  const body = new URLSearchParams({
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': req.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(req.amount),
    'line_items[0][price_data][product_data][name]': req.description.slice(0, 250),
    success_url: req.successUrl,
    cancel_url: req.cancelUrl,
    client_reference_id: req.reference,
    'metadata[online_payment_id]': req.reference,
    'payment_intent_data[metadata][online_payment_id]': req.reference,
  });
  if (req.customerEmail) body.set('customer_email', req.customerEmail);
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
      // Retrying the same start never opens two sessions.
      'idempotency-key': `checkout-${req.reference}`,
    },
    body,
  });
  const json = (await res.json().catch(() => null)) as { id?: string; url?: string; error?: { message?: string } } | null;
  if (!res.ok || !json?.id || !json.url) {
    throw new Error(`Stripe refused the checkout: ${json?.error?.message ?? res.status}`);
  }
  return { providerRef: json.id, url: json.url };
}

/**
 * Stripe's webhook signature: `t=<unix>,v1=<hex hmac>` over "<t>.<raw body>"
 * with the endpoint's signing secret, within five minutes.
 */
export function verifyStripeSignature(rawBody: Buffer, header: string | undefined, secret: string, toleranceSeconds = 300, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  ) as Record<string, string>;
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody.toString('utf8')}`).digest('hex');
  const given = header
    .split(',')
    .filter((kv) => kv.trim().startsWith('v1='))
    .map((kv) => kv.trim().slice(3));
  return given.some((g) => g.length === expected.length && timingSafeEqual(Buffer.from(g), Buffer.from(expected)));
}

/** What our webhook handler needs from a Stripe event. */
export interface StripeEvent {
  id: string;
  type: string;
  data: { object: { id: string; payment_status?: string; amount_total?: number; currency?: string; payment_intent?: string | null } };
}
