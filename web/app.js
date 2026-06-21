// bee cockpit SPA — vanilla JS, zero deps, no build (CP123 Cluster G, item G1).
// Read-mostly (Q5): every call is a GET against the read-only API in web/server.mjs. The cockpit
// surfaces brain/runs/queue-state/evals and runs bee's READ-ONLY queries (brain/explain/pick-tool);
// it never enqueues, scaffolds, or audits from the browser.

"use strict";

// ---------- tiny helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// HTML-escape ALL server-derived text before it touches innerHTML (the brain corpus is trusted
// repo content, but escape on principle — no string from an API is ever interpolated raw).
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getJson(url) {
  try {
    const r = await fetch(url);
    return await r.json();
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : "fetch failed" };
  }
}

// ---------- view routing ----------
const VIEWS = ["brain", "runs", "queue", "evals", "ask"];
const loaded = new Set();

function showView(name) {
  $$(".rail button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  VIEWS.forEach((v) => $(`#view-${v}`).classList.toggle("active", v === name));
  // Lazy-load each view's data once (the run-log/queue/eval can refresh on revisit too).
  if (name === "runs") loadRuns();
  else if (name === "queue") loadQueue();
  else if (name === "evals") loadEvals();
  else if (name === "brain" && !loaded.has("brain")) loadBrainFiles();
}

$$(".rail button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));

// ============================================================
// 1 · BRAIN BROWSER — search hits + render a whole artifact
// ============================================================
const BRAIN_FILES = [
  ["EXPERTISE-MAP.md", "Expertise map"],
  ["OPINIONS.md", "Opinions (O-)"],
  ["KNOWN-PITFALLS.md", "Known pitfalls (P-)"],
  ["BATTLE-TESTED-SCENARIOS.md", "Scenarios (S-)"],
  ["TOOL-MATRIX.md", "Tool matrix"],
  ["GAPS-AND-DISPUTES.md", "Gaps & disputes (G-)"],
];

function loadBrainFiles() {
  loaded.add("brain");
  const host = $("#brain-files");
  host.innerHTML = BRAIN_FILES.map(
    ([f, label]) => `<button data-file="${esc(f)}">${esc(label)}</button>`,
  ).join("");
  $$("#brain-files button").forEach((b) =>
    b.addEventListener("click", () => {
      $$("#brain-files button").forEach((x) => x.classList.toggle("active", x === b));
      renderBrainDoc(b.dataset.file);
    }),
  );
}

// A deliberately minimal, SAFE markdown renderer: escape FIRST, then apply a handful of block/
// inline rules. Not a full parser — just enough to make the brain artifacts legible. Because we
// escape before formatting, no markdown in the corpus can inject markup.
function renderMarkdown(md) {
  const lines = String(md).replace(/\r/g, "").split("\n");
  let html = "";
  let inList = false;
  let inCode = false;
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
  for (let raw of lines) {
    if (/^```/.test(raw)) {
      if (!inCode) { closeList(); html += "<pre><code>"; inCode = true; }
      else { html += "</code></pre>"; inCode = false; }
      continue;
    }
    if (inCode) { html += esc(raw) + "\n"; continue; }
    if (/^---\s*$/.test(raw)) { closeList(); html += "<hr/>"; continue; }
    if (/^\s*$/.test(raw)) { closeList(); continue; }
    const inline = (t) =>
      esc(t)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, "<em>$1</em>");
    let m;
    if ((m = raw.match(/^(#{1,6})\s+(.*)$/))) {
      closeList();
      const lvl = Math.min(m[1].length, 3);
      html += `<h${lvl}>${inline(m[2])}</h${lvl}>`;
    } else if ((m = raw.match(/^\s*[-*]\s+(.*)$/))) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(m[1])}</li>`;
    } else {
      closeList();
      html += `<p>${inline(raw)}</p>`;
    }
  }
  if (inCode) html += "</code></pre>";
  closeList();
  return html;
}

async function renderBrainDoc(file) {
  const pane = $("#brain-pane");
  pane.innerHTML = `<div class="loading">loading ${esc(file)}</div>`;
  const r = await getJson(`/api/brain-doc?file=${encodeURIComponent(file)}`);
  if (!r.ok) {
    pane.innerHTML = `<div class="empty note">Could not load ${esc(file)}${r.error ? " — " + esc(r.error) : ""}</div>`;
    return;
  }
  pane.innerHTML = `<div class="brain-doc">${renderMarkdown(r.markdown)}</div>`;
}

function hitCard(h) {
  const score = typeof h.score === "number" ? h.score.toFixed(1) : "";
  return `<div class="card click" data-id="${esc(h.id)}">
    <span class="score">${esc(score)}</span>
    <span class="id">${esc(h.id)}</span>
    <div class="head">${esc(h.heading || "")}</div>
    <div class="excerpt">${esc((h.excerpt || "").slice(0, 280))}</div>
    <div class="src">in ${esc(h.file || "")} — click to read detection + fix</div>
  </div>`;
}

async function runBrainSearch(q) {
  const pane = $("#brain-pane");
  if (!q.trim()) { pane.innerHTML = `<div class="empty">Search above, or pick an artifact on the left to read it.</div>`; return; }
  pane.innerHTML = `<div class="loading">searching the brain</div>`;
  const r = await getJson(`/api/brain?q=${encodeURIComponent(q)}`);
  const hits = Array.isArray(r) ? r : r.hits || [];
  if (!hits.length) { pane.innerHTML = `<div class="empty note">No hits for “${esc(q)}”. Try fewer / different terms.</div>`; return; }
  pane.innerHTML = `<div class="count" style="margin-bottom:0.8rem">${hits.length} hit${hits.length === 1 ? "" : "s"} for “${esc(q)}”</div><div class="cards">${hits.map(hitCard).join("")}</div>`;
  $$("#brain-pane .card.click").forEach((c) =>
    c.addEventListener("click", () => openExplainInline(c.dataset.id)),
  );
}

// Inline-expand a hit into its full detection+fix (the `bee explain` body), rendered as markdown.
async function openExplainInline(id) {
  const pane = $("#brain-pane");
  const back = pane.innerHTML;
  pane.innerHTML = `<div class="loading">loading ${esc(id)}</div>`;
  const r = await getJson(`/api/explain?id=${encodeURIComponent(id)}`);
  if (!r || r.ok === false || !r.body) {
    pane.innerHTML = `<div class="empty note">Could not explain ${esc(id)}${r && r.error ? " — " + esc(r.error) : ""}</div>`;
    return;
  }
  pane.innerHTML =
    `<button class="btn ghost" id="brain-back" style="margin-bottom:1rem">← back to results</button>` +
    `<div class="brain-doc">${renderMarkdown(r.body)}</div>`;
  $("#brain-back").addEventListener("click", () => {
    pane.innerHTML = back;
    $$("#brain-pane .card.click").forEach((c) =>
      c.addEventListener("click", () => openExplainInline(c.dataset.id)),
    );
  });
}

let brainTimer = null;
$("#brain-q").addEventListener("input", (e) => {
  clearTimeout(brainTimer);
  const q = e.target.value;
  brainTimer = setTimeout(() => runBrainSearch(q), 220);
});
$("#brain-clear").addEventListener("click", () => {
  $("#brain-q").value = "";
  runBrainSearch("");
  $$("#brain-files button").forEach((x) => x.classList.remove("active"));
});

// ============================================================
// 2 · RUN LOG — tail logs/runs.jsonl
// ============================================================
async function loadRuns() {
  const pane = $("#runs-pane");
  pane.innerHTML = `<div class="loading">loading runs</div>`;
  const r = await getJson("/api/runs?limit=100");
  const runs = r.runs || [];
  $("#runs-count").textContent = r.total ? `${r.total} total runs · showing ${runs.length} newest` : "";
  if (!runs.length) {
    pane.innerHTML = `<div class="empty note">No runs logged yet. Run any <code>bee</code> command (e.g. <code>bee brain "retry"</code>) and it appends a row to <code>logs/runs.jsonl</code>.</div>`;
    return;
  }
  const rows = runs
    .map((x) => {
      const when = x.startedAt ? new Date(x.startedAt).toLocaleString() : "—";
      const dur = typeof x.durationMs === "number" ? x.durationMs.toFixed(1) + " ms" : x.duration != null ? esc(x.duration) : "—";
      const ok = x.outcome === "ok";
      return `<tr>
        <td class="num">${esc(when)}</td>
        <td class="cmd">${esc(x.command || "—")}</td>
        <td>${esc(x.model || "—")}</td>
        <td class="num">${esc(dur)}</td>
        <td>${x.cost == null ? '<span class="muted">—</span>' : esc(x.cost)}</td>
        <td><span class="pill ${ok ? "ok" : "err"}"><span class="dot ${ok ? "ok" : "err"}"></span>${esc(x.outcome || "?")}</span></td>
      </tr>`;
    })
    .join("");
  pane.innerHTML = `<table>
    <thead><tr><th>when</th><th>command</th><th>model</th><th>duration</th><th>cost</th><th>outcome</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

// ============================================================
// 3 · QUEUE & DLQ — the cached dispatch-run lifecycle
// ============================================================
async function loadQueue() {
  const pane = $("#queue-pane");
  pane.innerHTML = `<div class="loading">loading the last run</div>`;
  const r = await getJson("/api/queue");
  if (!r.ok || !r.result) {
    pane.innerHTML = `<div class="empty note">No dispatch run captured yet.<br/>${esc(r.note || "Start an ephemeral Redis and run the dispatch flow to populate this view.")}</div>`;
    return;
  }
  const rep = r.result;
  // Pull the worker-process step (carries processed/deduped/deadLettered/effects/dlqDepth) and
  // the enqueue step (carries the duplicate's deduped:true).
  const stepOut = (name) => (rep.steps || []).find((s) => s.name === name)?.out || {};
  const proc = stepOut("process") || {};
  const enq = stepOut("enqueue") || {};
  const effects = rep.effects ?? proc.effects ?? "—";
  const dlq = rep.dlqDepth ?? proc.dlqDepth ?? "—";
  const processed = proc.processed ?? "—";
  const deadLettered = proc.deadLettered ?? "—";
  const held = rep.invariantHeld === true;
  const dupDeduped = enq && enq.duplicate ? enq.duplicate.deduped === true : null;

  const banner = `<div class="invariant-banner ${held ? "held" : "failed"}">
    <span class="big">${held ? "✓" : "✕"}</span>
    <span>THE ONE INVARIANT ${held ? "<b>held</b>" : "<b>FAILED</b>"} on the last run — ${held ? "the duplicate enqueue collapsed to exactly one effect, and the poison job dead-lettered." : "review the metrics below."}</span>
  </div>`;

  const metrics = `<div class="lifecycle">
    <div class="metric"><div class="v ${effects === 1 ? "ok" : "err"} num">${esc(effects)}</div><div class="k">effects</div><div class="sub">two enqueues of <code>order-42</code>, same key → ${effects === 1 ? "<b>one</b> effect (DB unique constraint, O-2)" : "expected 1"}</div></div>
    <div class="metric"><div class="v accent num">${esc(processed)}</div><div class="k">processed</div><div class="sub">jobs whose effect was applied</div></div>
    <div class="metric"><div class="v warn num">${esc(deadLettered)}</div><div class="k">dead-lettered</div><div class="sub">poison job retried with jittered backoff (O-9/P-X6), then DLQ'd</div></div>
    <div class="metric"><div class="v err num">${esc(dlq)}</div><div class="k">DLQ depth</div><div class="sub">redrive-able dead-letter records (O-10/S-1)</div></div>
  </div>`;

  const jobs = `<h3 class="serif" style="font-size:1.1rem;margin:0 0 0.7rem">Jobs this run</h3>
    <div class="jobrow"><span class="jid">order-42</span><span class="meta">first enqueue — processed, effect applied</span><span class="pill ok"><span class="dot ok"></span>effect ✓</span></div>
    <div class="jobrow"><span class="jid">order-42 <span class="muted">(duplicate)</span></span><span class="meta">same idempotency key — ${dupDeduped === true ? "deduped at enqueue (deduped:true)" : "absorbed by the DB unique constraint"}</span><span class="pill warn"><span class="dot warn"></span>${dupDeduped === true ? "deduped" : "no-op effect"}</span></div>
    <div class="jobrow"><span class="jid">poison-1</span><span class="meta">forced failure — retried with jittered backoff, attempts exhausted</span><span class="pill err"><span class="dot err"></span>dead-lettered</span></div>`;

  const asOf = r.asOf ? `<div class="count" style="margin-top:1.2rem">last dispatch run captured ${esc(new Date(r.asOf).toLocaleString())}</div>` : "";
  pane.innerHTML = banner + metrics + jobs + asOf;
}

// ============================================================
// 4 · EVAL SCORES — the pyramid result (green/red, not Likert)
// ============================================================
async function loadEvals() {
  const pane = $("#evals-pane");
  pane.innerHTML = `<div class="loading">loading evals</div>`;
  const r = await getJson("/api/eval");
  if (!r.ok || !r.result) {
    pane.innerHTML = `<div class="empty note">Eval cache not built yet.<br/>${esc(r.note || "Run `node bin/bee.js eval --json > eval/eval-result.json`.")}</div>`;
    return;
  }
  const res = r.result;
  const results = res.results || [];
  $("#evals-count").textContent =
    `${res.passed}/${res.total} passing` +
    (res.allPass ? " — all green" : " — RED, see below") +
    (r.asOf ? ` · as of ${new Date(r.asOf).toLocaleString()}` : "");
  if (!results.length) {
    pane.innerHTML = `<div class="empty note">Eval result had no tasks.</div>`;
    return;
  }
  const cells = results
    .map((t) => {
      const pass = t.pass === true;
      const sids = (t.sids || []).join(", ");
      return `<div class="eval-cell ${pass ? "pass" : "fail"}">
        <div class="top">
          <span><span class="gid">${esc(t.id)}</span><span class="ci">${t.ciBlocking ? "CI-blocking" : ""}</span></span>
          <span class="pill ${pass ? "ok" : "err"}"><span class="dot ${pass ? "ok" : "err"}"></span>${pass ? "pass" : "fail"}</span>
        </div>
        <div class="title">${esc(t.title || "")}</div>
        <div class="sids"><span class="lvl">L${esc(t.level)}</span>${sids ? " · " + esc(sids) : ""}</div>
      </div>`;
    })
    .join("");
  pane.innerHTML = `<div class="eval-grid">${cells}</div>`;
}

// ============================================================
// 5 · ASK THE EMPLOYEE — search / explain / pick-tool
// ============================================================
const askBars = { search: "#ask-bar-search", explain: "#ask-bar-explain", pick: "#ask-bar-pick" };
$$("#ask-mode button").forEach((b) =>
  b.addEventListener("click", () => {
    $$("#ask-mode button").forEach((x) => x.classList.toggle("active", x === b));
    Object.entries(askBars).forEach(([mode, sel]) => {
      $(sel).style.display = mode === b.dataset.mode ? "flex" : "none";
    });
    $("#ask-answer").innerHTML = `<div class="empty">Ask a question above.</div>`;
  }),
);

function field(lbl, valHtml) {
  return `<div class="field"><div class="lbl">${esc(lbl)}</div><div class="val">${valHtml}</div></div>`;
}

async function askSearch() {
  const q = $("#ask-search-q").value.trim();
  const out = $("#ask-answer");
  if (!q) return;
  out.innerHTML = `<div class="loading">asking bee</div>`;
  const r = await getJson(`/api/brain?q=${encodeURIComponent(q)}`);
  const hits = Array.isArray(r) ? r : r.hits || [];
  if (!hits.length) { out.innerHTML = `<div class="empty note">bee found nothing for “${esc(q)}”.</div>`; return; }
  out.innerHTML = `<div class="cards">${hits.slice(0, 5).map(hitCard).join("")}</div>`;
  $$("#ask-answer .card.click").forEach((c) =>
    c.addEventListener("click", async () => {
      const e = await getJson(`/api/explain?id=${encodeURIComponent(c.dataset.id)}`);
      if (e && e.body) out.innerHTML = `<div class="ask-answer"><div class="brain-doc">${renderMarkdown(e.body)}</div></div>`;
    }),
  );
}

async function askExplain() {
  const id = $("#ask-explain-id").value.trim();
  const out = $("#ask-answer");
  if (!id) return;
  out.innerHTML = `<div class="loading">looking up ${esc(id)}</div>`;
  const r = await getJson(`/api/explain?id=${encodeURIComponent(id)}`);
  if (!r || r.ok === false || !r.body) { out.innerHTML = `<div class="empty note">No entry for ${esc(id)}${r && r.error ? " — " + esc(r.error) : ""}.</div>`; return; }
  out.innerHTML = `<div class="ask-answer"><div class="brain-doc">${renderMarkdown(r.body)}</div></div>`;
}

async function askPick() {
  const profile = $("#ask-pick-profile").value;
  const out = $("#ask-answer");
  out.innerHTML = `<div class="loading">walking the decision oracle</div>`;
  const r = await getJson(`/api/pick-tool?profile=${encodeURIComponent(profile)}`);
  if (!r || r.ok === false || !r.recommendation) { out.innerHTML = `<div class="empty note">Could not pick a tool${r && r.error ? " — " + esc(r.error) : ""}.</div>`; return; }
  let html = `<div class="ask-answer">`;
  html += field("Recommendation", `<span class="serif" style="font-size:1.2rem;color:var(--accent)">${esc(r.recommendation)}</span>`);
  if (r.rationale) html += field("Why", esc(r.rationale));
  if (r.fallsShort) html += field("Where it falls short (O-28)", esc(r.fallsShort));
  if (r.reversibility) html += field("Reversibility cost (O-13)", esc(r.reversibility));
  if (Array.isArray(r.alternatives) && r.alternatives.length) {
    const alts = r.alternatives.map((a) => `<li>${esc(typeof a === "string" ? a : a.name + (a.when ? " — " + a.when : ""))}</li>`).join("");
    html += field("Alternatives", `<ul style="margin:0;padding-left:1.1rem">${alts}</ul>`);
  }
  if (r.source) html += field("Source", `<code>${esc(r.source)}</code>`);
  html += `</div>`;
  out.innerHTML = html;
}

$("#ask-search-go").addEventListener("click", askSearch);
$("#ask-search-q").addEventListener("keydown", (e) => { if (e.key === "Enter") askSearch(); });
$("#ask-explain-go").addEventListener("click", askExplain);
$("#ask-explain-id").addEventListener("keydown", (e) => { if (e.key === "Enter") askExplain(); });
$("#ask-pick-go").addEventListener("click", askPick);

// ============================================================
// masthead live stats
// ============================================================
async function loadStats() {
  const [evalR, runR, queueR] = await Promise.all([
    getJson("/api/eval"),
    getJson("/api/runs?limit=1"),
    getJson("/api/queue"),
  ]);
  if (evalR.ok && evalR.result) {
    $("#stat-evals").textContent = `${evalR.result.passed}/${evalR.result.total}`;
    $("#stat-evals").className = "v " + (evalR.result.allPass ? "ok" : "err");
  } else {
    $("#stat-evals").textContent = "—";
  }
  $("#stat-runs").textContent = runR.total != null ? runR.total : "—";
  if (queueR.ok && queueR.result) {
    const held = queueR.result.invariantHeld === true;
    $("#stat-invariant").textContent = held ? "held ✓" : "FAILED";
    $("#stat-invariant").className = "v " + (held ? "ok" : "err");
  } else {
    $("#stat-invariant").textContent = "—";
  }
}

// ---------- boot ----------
loadBrainFiles();
loadStats();
showView("brain");
