// SEEDED-BROKEN webhook handler — does the work INLINE (P-X7) with a too-short
// dedup TTL (P-X5). Both bugs are intentional.
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

export async function handler(req, res) {
  const sig = req.headers["stripe-signature"];
  const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

  // P-X5: dedup TTL of 6 hours (21600s) — SHORTER than Stripe's ≥3-day retry window.
  // A day-2 retry looks brand-new → double-processed.
  await redis.setex(`evt:${event.id}`, 21600, "1");

  // P-X7: doing the real work INLINE before responding. A slow effect (>5-15s) makes
  // Stripe time out and retry work already done. There is NO 202 ack here.
  await chargeCustomer(event.data.object); // slow, synchronous effect
  await sendReceiptEmail(event.data.object);

  res.status(200).send("done"); // responds only AFTER the work — wrong
}

async function chargeCustomer(o) {
  /* ... */
}
async function sendReceiptEmail(o) {
  /* ... */
}
