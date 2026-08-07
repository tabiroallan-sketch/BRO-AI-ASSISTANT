import type { MemoryRecord } from './types.js';

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'to',
  'of',
  'for',
  'with',
  'on',
  'at',
  'in',
  'from',
  'by',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'you',
  'your',
  'my',
  'i',
  'me',
  'we',
  'our',
  'as',
  'if',
  'then',
  'so',
  'not',
  'no',
  'can',
  'could',
  'will',
  'would',
  'do',
  'does',
  'did',
  'should',
  'may',
  'might',
  'what',
  'why',
  'how',
  'when',
  'where',
  'who',
  'about',
  'into',
  'them',
  'their',
  'there',
  'here',
  'have',
  'has',
  'had',
  'more',
  'most',
  'some',
  'such',
  'than',
  'too',
  'very',
]);

/** Lowercased word tokens for the given text, stopwords removed. */
export function wordTokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']{2,}/g) ?? []).filter(
    (token) => !STOPWORDS.has(token),
  );
}

/** Contiguous 3-gram chunks over the alphanumeric characters of the text. */
export function charGrams(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized.length < 3) {
    return [];
  }
  const grams: string[] = [];
  for (let index = 0; index <= normalized.length - 3; index += 1) {
    grams.push(normalized.slice(index, index + 3));
  }
  return grams;
}

type DocVector = {
  id: string;
  words: string[];
  grams: string[];
  word: Map<string, number>;
  gram: Map<string, number>;
  wordNorm: number;
  gramNorm: number;
};

export type MemoryVectorIndex = {
  docs: DocVector[];
  idfWord: Map<string, number>;
  idfGram: Map<string, number>;
};

function termFrequencies(tokens: string[]): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const token of tokens) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }
  return frequencies;
}

function documentFrequency(docs: Array<{ id: string; words: string[]; grams: string[] }>): {
  word: Map<string, number>;
  gram: Map<string, number>;
} {
  const word = new Map<string, number>();
  const gram = new Map<string, number>();
  for (const doc of docs) {
    for (const token of new Set(doc.words)) {
      word.set(token, (word.get(token) ?? 0) + 1);
    }
    for (const token of new Set(doc.grams)) {
      gram.set(token, (gram.get(token) ?? 0) + 1);
    }
  }
  return { word, gram };
}

function inverseDocumentFrequency(
  docCount: number,
  frequencies: Map<string, number>,
): Map<string, number> {
  const idf = new Map<string, number>();
  for (const [term, df] of frequencies) {
    idf.set(term, Math.log((docCount + 1) / (df + 1)) + 1);
  }
  return idf;
}

/**
 * Builds a lightweight TF-IDF vector index over the memories' key, value and
 * category text. Word tokens carry most of the signal; character 3-grams add
 * typo tolerance and prefix recall. Pure, deterministic, no dependencies.
 */
export function buildMemoryIndex(records: MemoryRecord[]): MemoryVectorIndex {
  const docs = records.map((record) => {
    const words = wordTokens(`${record.key} ${record.value} ${record.category ?? ''}`);
    const grams = charGrams(`${record.key} ${record.value} ${record.category ?? ''}`);
    return { id: record.id, words, grams };
  });
  const { word: dfWord, gram: dfGram } = documentFrequency(docs);
  const idfWord = inverseDocumentFrequency(docs.length, dfWord);
  const idfGram = inverseDocumentFrequency(docs.length, dfGram);

  const docVectors = docs.map((doc) => {
    const wordTf = termFrequencies(doc.words);
    const gramTf = termFrequencies(doc.grams);
    const word = new Map<string, number>();
    let wordNorm = 0;
    for (const [term, tf] of wordTf) {
      const weight = (tf / (wordTf.get(doc.words[0] ?? '') ?? 1)) * (idfWord.get(term) ?? 0);
      word.set(term, weight);
      wordNorm += weight * weight;
    }
    const gram = new Map<string, number>();
    let gramNorm = 0;
    for (const [term, tf] of gramTf) {
      const weight = tf * (idfGram.get(term) ?? 0);
      gram.set(term, weight);
      gramNorm += weight * weight;
    }
    return {
      id: doc.id,
      words: doc.words,
      grams: doc.grams,
      word,
      gram,
      wordNorm: Math.sqrt(wordNorm),
      gramNorm: Math.sqrt(gramNorm),
    };
  });

  return { docs: docVectors, idfWord, idfGram };
}

function cosine(
  query: Map<string, number>,
  doc: Map<string, number>,
  queryNorm: number,
  docNorm: number,
): number {
  if (queryNorm === 0 || docNorm === 0) {
    return 0;
  }
  let dot = 0;
  for (const [term, weight] of query) {
    const docWeight = doc.get(term);
    if (docWeight !== undefined) {
      dot += weight * docWeight;
    }
  }
  return dot / (queryNorm * docNorm);
}

export type MemoryVectorHit = {
  id: string;
  score: number;
};

/**
 * Searches the index with a query string, blending word-level cosine similarity
 * (80%) with character-3-gram cosine similarity (20%). Returns hits sorted by
 * score descending; scores are in the range 0..1.
 */
export function searchMemoryIndex(
  index: MemoryVectorIndex,
  query: string,
  topK = 20,
): MemoryVectorHit[] {
  const words = wordTokens(query);
  const grams = charGrams(query);
  const wordTf = termFrequencies(words);
  const gramTf = termFrequencies(grams);
  const maxWordTf = wordTf.get(words[0] ?? '') ?? 1;
  const word = new Map<string, number>();
  let wordNorm = 0;
  for (const [term, tf] of wordTf) {
    const weight = (tf / maxWordTf) * (index.idfWord.get(term) ?? 0);
    word.set(term, weight);
    wordNorm += weight * weight;
  }
  const gram = new Map<string, number>();
  let gramNorm = 0;
  for (const [term, tf] of gramTf) {
    const weight = tf * (index.idfGram.get(term) ?? 0);
    gram.set(term, weight);
    gramNorm += weight * weight;
  }
  const queryWordNorm = Math.sqrt(wordNorm);
  const queryGramNorm = Math.sqrt(gramNorm);

  const scored: MemoryVectorHit[] = index.docs.map((doc) => {
    const wordSim = cosine(word, doc.word, queryWordNorm, doc.wordNorm);
    const gramSim = cosine(gram, doc.gram, queryGramNorm, doc.gramNorm);
    return { id: doc.id, score: wordSim * 0.8 + gramSim * 0.2 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored
    .slice(0, topK)
    .map((hit) => ({ id: hit.id, score: Math.max(0, Math.min(1, hit.score)) }));
}
