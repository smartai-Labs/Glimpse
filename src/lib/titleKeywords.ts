/** Local, title-only keyword extraction. No model, requests or persistent history. */
export interface KeywordSource { title: string; url: string }
export interface TitleKeyword { term: string; documentCount: number }

const STOP = new Set(`的 了 着 过 和 与 及 或 在 从 到 为 对 把 被 是 有 我 你 您 他 她 它 我们 你们 他们 这 那 这个 那个 一 一个 一种 用 做 做了 如何 怎么 什么 为什么 哪些 可以 通过 关于 进行 相关 实际 最新 全新 更多 全部 首页 登录 注册 官网 官方 官方网站 网站 网页 页面 未命名 标签 新建 搜索 结果 使用 教程 指南 入门 安装 开发 下载 帮助 文档 介绍 分享 体验 经验 方法 工具 内容 资料 完整 免费 在线 推荐 详解 保存 测试
the a an and or of to in on at by for from with without is are be it its this that these those your you our we how what why which using use used get getting started guide guides tutorial tutorials introduction intro overview official website site home homepage login sign sign-in account register download downloads documentation docs help welcome untitled new tab best tips latest more`.split(/\s+/));

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;
const HAN = /^\p{Script=Han}+$/u;
const LETTER = /\p{L}/u;
const keyOf = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const suffixPattern = /\s+(?:[-–—|·])\s+|[|｜_]/u;

interface Document { title: string; host: string; url: string }
interface Token { text: string; key: string; start: number; end: number }
interface Candidate { term: string; key: string; parts: string[]; documents: Set<number>; whole: number; single: boolean; score: number }

function documentsFrom(sources: readonly KeywordSource[]): Document[] {
  const raw = sources.map(source => {
    const title = source.title.normalize('NFKC').replace(/^\s*(?:\(\d+\)|\[\d+\])\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 240);
    try {
      // Hashes can identify different pages in client-side routers; keep them intact.
      const url = new URL(source.url);
      return { title, host: url.hostname.replace(/^www\./, ''), url: url.href };
    } catch { return { title, host: '', url: source.url }; }
  });
  const hostTitles = new Map<string, Set<string>>(), suffixes = new Map<string, Set<string>>();
  for (const doc of raw) {
    if (!doc.host) continue;
    const title = keyOf(doc.title), suffix = title.split(suffixPattern).at(-1)!;
    const titles = hostTitles.get(doc.host) ?? new Set<string>(); titles.add(title); hostTitles.set(doc.host, titles);
    if (suffix !== title && suffix.length <= 24) {
      const id = `${doc.host}\n${suffix}`, titles = suffixes.get(id) ?? new Set<string>();
      titles.add(title); suffixes.set(id, titles);
    }
  }
  const seenTitles = new Set<string>(), seenUrls = new Set<string>();
  return raw.flatMap(doc => {
    const pieces = doc.title.split(suffixPattern);
    if (pieces.length > 1) {
      const suffix = keyOf(pieces.at(-1)!), count = suffixes.get(`${doc.host}\n${suffix}`)?.size ?? 0;
      const hostName = doc.host.split('.')[0];
      if (STOP.has(suffix) || suffix === doc.host || suffix === hostName ||
        count >= 3 && count / (hostTitles.get(doc.host)?.size ?? 1) >= .6) {
        doc.title = pieces.slice(0, -1).join(' | ');
      }
    }
    const title = keyOf(doc.title);
    if (!title || STOP.has(title) || seenTitles.has(title) || doc.url && seenUrls.has(doc.url)) return [];
    seenTitles.add(title); if (doc.url) seenUrls.add(doc.url);
    return [doc];
  });
}

function wordRuns(title: string): Token[][] {
  const tokens: Token[] = [];
  // Keep names such as GPT-5.2, Next.js, C++ and C# intact before word segmentation.
  const words = /[\p{Script=Latin}\d]+(?:[._+#-][\p{Script=Latin}\d]+)*(?:\+\+|#)?|\p{Script=Han}+|[\p{L}\p{N}]+/gu;
  for (const match of title.matchAll(words)) {
    if (HAN.test(match[0]) && segmenter) {
      for (const part of segmenter.segment(match[0])) if (part.isWordLike) {
        tokens.push({ text: part.segment, key: keyOf(part.segment), start: match.index + part.index, end: match.index + part.index + part.segment.length });
      }
    } else tokens.push({ text: match[0], key: keyOf(match[0]), start: match.index, end: match.index + match[0].length });
  }
  const runs: Token[][] = [];
  let run: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i];
    // ICU versions can split a common Chinese stop word into individual characters.
    for (let end = Math.min(tokens.length - 1, i + 3); end > i; end--) {
      const phrase = title.slice(token.start, tokens[end].end);
      if (HAN.test(phrase) && STOP.has(phrase)) {
        token = { text: phrase, key: phrase, start: token.start, end: tokens[end].end }; i = end; break;
      }
    }
    const previous = run.at(-1);
    if (STOP.has(token.key) || !LETTER.test(token.text)) { if (run.length) runs.push(run); run = []; continue; }
    if (previous && !/^\s*$/u.test(title.slice(previous.end, token.start))) { runs.push(run); run = []; }
    run.push(token);
  }
  if (run.length) runs.push(run);
  return runs;
}

export function extractTitleKeywords(sources: readonly KeywordSource[], limit = 8): TitleKeyword[] {
  const documents = documentsFrom(sources), candidates = new Map<string, Candidate>(), wordCounts = new Map<string, number>();
  documents.forEach((doc, index) => {
    const local = new Map<string, { term: string; parts: string[]; whole: boolean; single: boolean }>(), words = new Set<string>();
    for (const run of wordRuns(doc.title)) {
      run.forEach(token => words.add(token.key));
      for (let start = 0; start < run.length; start++) {
        for (let end = start; end < Math.min(run.length, start + 6); end++) {
          const term = doc.title.slice(run[start].start, run[end].end), key = keyOf(term);
          if (term.length > (/\p{Script=Han}/u.test(term) ? 12 : 32)) break;
          if (term.length < 2 || STOP.has(key)) continue;
          const whole = start === 0 && end === run.length - 1;
          const previous = local.get(key);
          local.set(key, { term, parts: run.slice(start, end + 1).map(token => token.key), whole: whole || !!previous?.whole, single: start === end });
        }
      }
    }
    words.forEach(word => wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1));
    for (const [key, value] of local) {
      const candidate = candidates.get(key) ?? { term: value.term, key, parts: value.parts, documents: new Set<number>(), whole: 0, single: value.single, score: 0 };
      candidate.documents.add(index); if (value.whole) candidate.whole++;
      candidates.set(key, candidate);
    }
  });
  const ranked = [...candidates.values()].filter(candidate => {
    const count = candidate.documents.size;
    // Avoid inventing phrases from incidental neighbours in a single title.
    if (count === 1 && !candidate.single && !candidate.whole) return false;
    const cohesion = count / Math.max(...candidate.parts.map(part => wordCounts.get(part) ?? count));
    if (!candidate.single && count > 1 && cohesion < .45) return false;
    const length = [...candidate.term.replace(/\s/g, '')].length;
    const quality = 1 + Math.min(length, 12) * .07 + (candidate.single ? 0 : .25) + .2 * candidate.whole / count;
    candidate.score = (count > 1 ? 2 + Math.log2(count) : 1) * quality * Math.sqrt(cohesion);
    if (documents.length >= 4 && count === documents.length) candidate.score *= .45;
    return true;
  }).sort((a, b) => b.score - a.score || b.term.length - a.term.length || a.key.localeCompare(b.key));

  const chosen: Candidate[] = [], covered = new Set<number>();
  while (chosen.length < Math.max(0, Math.min(8, limit)) && ranked.length) {
    let bestIndex = -1, bestScore = -Infinity;
    // Diversify the small shortlist instead of filling every chip with one title's words.
    for (let i = 0; i < Math.min(ranked.length, 100); i++) {
      const candidate = ranked[i];
      const redundant = chosen.some(other => {
        if (!other.key.includes(candidate.key) && !candidate.key.includes(other.key)) return false;
        if (candidate.key.includes(other.key) && other.parts.length > 1 && candidate.documents.size <= other.documents.size) return true;
        const overlap = [...candidate.documents].filter(id => other.documents.has(id)).length;
        return overlap / Math.max(candidate.documents.size, other.documents.size) >= .75;
      });
      if (redundant) continue;
      const overlap = [...candidate.documents].filter(id => covered.has(id)).length / candidate.documents.size;
      const score = candidate.score / (1 + overlap * .8);
      if (score > bestScore) { bestIndex = i; bestScore = score; }
    }
    if (bestIndex < 0) break;
    const candidate = ranked.splice(bestIndex, 1)[0];
    chosen.push(candidate); candidate.documents.forEach(id => covered.add(id));
  }
  return chosen.map(candidate => ({ term: candidate.term, documentCount: candidate.documents.size }));
}

/** Reuse results when only active flags, thumbnails or window focus change. */
export function createTitleKeywordProvider() {
  let signature = '', cached: TitleKeyword[] = [];
  return (sources: readonly KeywordSource[]): TitleKeyword[] => {
    const next = JSON.stringify(sources.map(source => [source.title, source.url]));
    if (next !== signature) {
      const keywords = extractTitleKeywords(sources);
      const remaining = new Map(keywords.map(keyword => [keyword.term, keyword]));
      // Keep surviving chips in their familiar order; append newly discovered terms.
      const retained = cached.flatMap(keyword => {
        const current = remaining.get(keyword.term);
        remaining.delete(keyword.term);
        return current ? [current] : [];
      });
      cached = [...retained, ...remaining.values()]; signature = next;
    }
    return cached;
  };
}
