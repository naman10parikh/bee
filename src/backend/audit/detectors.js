// Pitfall detectors — each maps a concrete observable pattern to a P-ID from
// brain/KNOWN-PITFALLS.md. A detector is a pure function over (content, path) →
// findings[]. These are intentionally lightweight (regex/heuristic, not a full
// type-aware AST) — the goal is a fast, dependency-free signal that catches the
// high-frequency 🔴 bugs, exactly the "Detect" lines the brain documents.
//
// Each finding cites: { pitfall, severity, file, line, message }. Severity:
//   high = duplicates money / never-dies; medium = correctness/ops; low = hygiene.

/**
 * @typedef {{ pitfall: string, severity: "high"|"medium"|"low", message: string,
 *   test: (content: string, path: string) => { line: number, snippet: string }[] }} Detector
 */

/**
 * Find all 1-based line numbers where `re` matches; return line + snippet.
 * @param {string} content
 * @param {RegExp} re
 * @returns {{ line: number, snippet: string }[]}
 */
function linesMatching(content, re) {
  const out = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const m = new RegExp(re).exec(lines[i]);
    if (m) out.push({ line: i + 1, snippet: lines[i].trim().slice(0, 160) });
  }
  return out;
}

/**
 * True if the file looks like a JS/TS source (not a doc/json).
 * @param {string} path
 * @returns {boolean}
 */
function isCode(path) {
  return /\.(?:js|mjs|cjs|ts|mts|cts|tsx)$/.test(path);
}

/**
 * Strip `//` line comments and `/* *\/` block comments so that explanatory prose
 * (e.g. a comment that NAMES the anti-pattern to say we avoid it) never defeats or
 * triggers a code-pattern check. Used for the NEGATIVE "is the correct pattern
 * present?" tests — the positive line-matching tests still run on the raw content
 * so reported line numbers stay accurate.
 * @param {string} content
 * @returns {string}
 */
function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // line comments (avoid eating http://)
}

/** @type {Detector[]} */
export const DETECTORS = [
  {
    pitfall: "P-B1",
    severity: "high",
    message: "Floating `^` on bullmq/queue lib — pin EXACT (BullMQ ships multiple patches/week; minors have regressed). O-17.",
    test: (c, p) => (/package\.json$/.test(p) ? linesMatching(c, /"(?:bullmq|@temporalio\/[a-z]+|inngest|@upstash\/qstash|svix)"\s*:\s*"[\^~]/) : []),
  },
  {
    pitfall: "P-I1",
    severity: "high",
    message: "Side effect / non-deterministic value OUTSIDE step.run() — code outside a step re-runs every invocation. Wrap it. P-I1.",
    test: (c, p) => {
      if (!isCode(p)) return [];
      // Heuristic: an Inngest function body (has `step` param / createFunction) with a
      // bare `await fetch(`/`Date.now()`/`Math.random()` NOT on a `step.run(` line.
      if (!/createFunction|async\s*\(\s*\{[^}]*step/.test(c)) return [];
      const out = [];
      const lines = c.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const l = lines[i];
        if (/\bstep\.(run|sleep|waitForEvent)\b/.test(l)) continue; // inside a step → fine
        if (/\bawait\s+fetch\(|\bDate\.now\(\)|\bMath\.random\(\)/.test(l)) {
          out.push({ line: i + 1, snippet: l.trim().slice(0, 160) });
        }
      }
      return out;
    },
  },
  {
    pitfall: "P-X6",
    severity: "high",
    message: "Bare exponential backoff (no jitter) → synchronized retry storm. Use full/equal jitter. P-X6/O-9.",
    test: (c, p) => {
      if (!isCode(p)) return [];
      // exponential backoff config with NO jitter in actual CODE (ignore comments —
      // a comment may say "no jitter" without that being the config).
      const code = stripComments(c);
      const hasExp = /backoff\s*:\s*\{[^}]*type\s*:\s*['"]exponential['"]/.test(code);
      const hasJitter = /\bjitter\b/i.test(code);
      if (!hasExp || hasJitter) return [];
      return linesMatching(c, /backoff\s*:\s*\{[^}]*type\s*:\s*['"]exponential['"]/);
    },
  },
  {
    pitfall: "P-X7",
    severity: "high",
    message: "Webhook work done INLINE (no 202-before-work) → provider timeout retries completed work. verify→dedup→202→async. P-X7/O-5.",
    test: (c, p) => {
      if (!isCode(p)) return [];
      // A webhook handler (mentions a signature header / webhook) that does NOT
      // return a 202 status anywhere in CODE — i.e. it answers synchronously after work.
      const code = stripComments(c);
      const looksWebhook = /webhook|stripe-signature|x-shopify-hmac|svix-signature|constructEvent/i.test(code);
      if (!looksWebhook) return [];
      // "returns 202" = an actual status(202)/statusCode=202/writeHead(202), not a bare number.
      if (/status\(\s*202|statusCode\s*=\s*202|writeHead\(\s*202/.test(code)) return [];
      // flag the handler entry line (or the line that does inline work before responding).
      const entry = linesMatching(c, /function\s+\w*[Hh]andler|function\s+\w*[Ww]ebhook|app\.(post|all)\(/);
      return entry.length ? [entry[0]] : [{ line: 1, snippet: "webhook handler without a 202 ack" }];
    },
  },
  {
    pitfall: "P-X5",
    severity: "high",
    message: "Dedup TTL likely shorter than the provider retry window → a day-2 retry double-processes. Size TTL to the LONGEST retry horizon. P-X5/O-8.",
    test: (c, p) => {
      if (!isCode(p)) return [];
      // A short dedup TTL: ttl/expire set to seconds/minutes/<= a few hours where a
      // webhook is in play. Flag ttl values that are clearly sub-day on a webhook file.
      const looksDedup = /ttl|expire|setex|EX\b|dedup/i.test(c);
      if (!looksDedup) return [];
      const out = [];
      const lines = c.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const l = lines[i];
        // ttlSeconds: 3600 | EX 3600 | setex(`key`, 21600, …) | expire(key, 21600)
        // The TTL number can be the 2nd/3rd arg, so allow a wider gap to the digits
        // but require a sub-day value (< 86400) — that's the P-X5 smell on a webhook.
        const m = /(?:ttl\w*|expire\w*|setex|\bEX\b)[^0-9\n]{0,40}?(\d{2,6})(?!\d)/i.exec(l);
        if (m) {
          const secs = Number(m[1]);
          if (secs >= 60 && secs < 86400) out.push({ line: i + 1, snippet: l.trim().slice(0, 160) });
        }
      }
      return out;
    },
  },
  {
    pitfall: "P-X8",
    severity: "medium",
    message: "Unbounded Promise.all fan-out → connection-pool / socket exhaustion. Bound concurrency (p-limit). P-X8.",
    // allow dotted receivers: Promise.all(job.data.items.map(...))
    test: (c, p) => (isCode(p) ? linesMatching(c, /Promise\.all\(\s*[\w.[\]]+\.map\(/) : []),
  },
  {
    pitfall: "P-X2",
    severity: "high",
    message: "Blocking await/setTimeout inside a step (treated as a durable wait) → platform step-timeout kills it. Use durable sleep. P-X2/O-16.",
    test: (c, p) => {
      if (!isCode(p)) return [];
      // A Promise-wrapped setTimeout used as a long wait — e.g.
      // `new Promise((resolve) => setTimeout(resolve, 5*60*1000))`. Match across the
      // arrow's param parens up to setTimeout.
      return linesMatching(c, /new Promise\(\s*(?:\([^)]*\)|\w*)\s*=>\s*setTimeout|new Promise\([^;]*setTimeout/);
    },
  },
  {
    pitfall: "P-X1",
    severity: "high",
    message: "Treating at-least-once as exactly-once — no idempotency key / DB unique constraint on the consumer. P-X1/O-2.",
    test: (c, p) => {
      if (!isCode(p)) return [];
      // A worker/consumer that processes jobs but shows no idempotency claim in CODE
      // (no jobId-as-key, no ON CONFLICT/unique-constraint, no dedup/claim). Strip
      // comments first so an explanatory comment ("no idempotency key") doesn't count.
      const code = stripComments(c);
      const isConsumer = /new Worker\(|\.process\(|on\(['"]message['"]/.test(code);
      if (!isConsumer) return [];
      const hasIdem = /ON CONFLICT|UNIQUE|idempotenc|dedup|claim\(|jobId/i.test(code);
      if (hasIdem) return [];
      const entry = linesMatching(c, /new Worker\(|\.process\(/);
      return entry.length ? [entry[0]] : [];
    },
  },
  {
    pitfall: "P-B3",
    severity: "high",
    message: "BullMQ < 5.78.1 — `maxStalledCount` silently exempts scheduler jobs → infinite stall loop. Upgrade ≥5.78.1. P-B3/S-1.",
    test: (c, p) => {
      if (!/package\.json$/.test(p)) return [];
      const out = [];
      const lines = c.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const m = /"bullmq"\s*:\s*"[\^~]?(\d+)\.(\d+)\.(\d+)"/.exec(lines[i]);
        if (m) {
          const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
          if (maj < 5 || (maj === 5 && (min < 78 || (min === 78 && pat < 1)))) {
            out.push({ line: i + 1, snippet: lines[i].trim() });
          }
        }
      }
      return out;
    },
  },
  {
    pitfall: "P-B4",
    severity: "medium",
    message: "`lockDuration` may be shorter than the longest job → false stalls → duplicate execution. lockDuration MUST exceed the longest job. P-B4.",
    test: (c, p) => {
      if (!isCode(p)) return [];
      const out = [];
      const lines = c.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const m = /lockDuration\s*:\s*(\d+)/.exec(lines[i]);
        if (m && Number(m[1]) < 30000) out.push({ line: i + 1, snippet: lines[i].trim().slice(0, 160) });
      }
      return out;
    },
  },
  {
    pitfall: "O-1",
    severity: "medium",
    message: 'Bare "exactly-once" without "effect" — anti-slop violation. Say "exactly-once *effect* on at-least-once transport". O-1.',
    test: (c) => {
      const out = [];
      const lines = c.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const l = lines[i];
        if (/exactly[ -]once/i.test(l) && !/effect/i.test(l)) {
          out.push({ line: i + 1, snippet: l.trim().slice(0, 160) });
        }
      }
      return out;
    },
  },
];
