// SEEDED-BROKEN Inngest function — the side effect is OUTSIDE the step (P-I1).
import { inngest } from "./client.js";

export const processOrder = inngest.createFunction(
  { id: "process-order" },
  { event: "order/created" },
  async ({ event, step }) => {
    // P-I1: a side effect + a non-deterministic value OUTSIDE step.run() — these
    // re-execute on EVERY invocation (the whole function re-runs per step). The
    // fetch fires N times; Date.now() differs between steps.
    const startedAt = Date.now();
    await fetch("https://api.example.com/charge", {
      method: "POST",
      body: JSON.stringify({ orderId: event.data.orderId, at: startedAt }),
    });

    // (only this one is correctly wrapped — the bug is the unwrapped fetch above)
    await step.run("record", async () => ({ recorded: true }));
  },
);
