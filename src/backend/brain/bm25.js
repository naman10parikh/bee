// A small, dependency-free BM25 index. Okapi BM25 (k1=1.5, b=0.75) over a set of
// documents. This is the search engine behind `bee brain` — it ranks the brain's
// pitfall/scenario/opinion chunks by relevance to a query.
//
// Why hand-rolled: the corpus is small (the six brain artifacts → a few hundred
// chunks) and bee's dependency budget is bullmq alone (PLAN §7). A full search
// dependency (lunr/minisearch) is more surface than the problem needs.

const K1 = 1.5;
const B = 0.75;

/**
 * Tokenize: lowercase, split on non-alphanumerics, keep hyphenated IDs intact-ish by
 * also emitting the joined form. Keeps tokens like "p-x5"/"px5" and "ttl" findable.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  const lower = text.toLowerCase();
  /** @type {string[]} */
  const toks = [];
  // word tokens (alphanumeric runs)
  for (const m of lower.matchAll(/[a-z0-9]+/g)) toks.push(m[0]);
  // ID tokens like p-x5 / s-3 / o-23 → also emit the compact form (px5/s3/o23)
  for (const m of lower.matchAll(/\b([pso])-([a-z]*\d+)\b/g)) toks.push(m[1] + m[2]);
  return toks;
}

/**
 * @typedef {{ id: string, text: string, [k: string]: any }} Doc
 */

export class BM25Index {
  /** @param {Doc[]} docs */
  constructor(docs) {
    this.docs = docs;
    /** @type {string[][]} */
    this.tokens = docs.map((d) => tokenize(d.text));
    this.N = docs.length;
    this.avgdl = this.tokens.reduce((s, t) => s + t.length, 0) / Math.max(1, this.N);
    // document frequency per term
    /** @type {Map<string, number>} */
    this.df = new Map();
    for (const toks of this.tokens) {
      for (const term of new Set(toks)) this.df.set(term, (this.df.get(term) ?? 0) + 1);
    }
    // term frequency per doc
    /** @type {Map<string, number>[]} */
    this.tf = this.tokens.map((toks) => {
      /** @type {Map<string, number>} */
      const m = new Map();
      for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
      return m;
    });
  }

  /**
   * Inverse document frequency (BM25 variant, always ≥ 0).
   * @param {string} term
   * @returns {number}
   */
  idf(term) {
    const n = this.df.get(term) ?? 0;
    return Math.log(1 + (this.N - n + 0.5) / (n + 0.5));
  }

  /**
   * Score a query against all docs; return the top-k with scores, highest first.
   * @param {string} query
   * @param {number} [k]
   * @returns {(Doc & { score: number })[]}
   */
  search(query, k = 5) {
    const qterms = tokenize(query);
    /** @type {{ idx: number, score: number }[]} */
    const scored = [];
    for (let i = 0; i < this.N; i += 1) {
      const dl = this.tokens[i].length;
      let score = 0;
      for (const term of qterms) {
        const f = this.tf[i].get(term);
        if (!f) continue;
        const idf = this.idf(term);
        score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * dl) / this.avgdl)));
      }
      if (score > 0) scored.push({ idx: i, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((s) => ({ ...this.docs[s.idx], score: Number(s.score.toFixed(4)) }));
  }
}
