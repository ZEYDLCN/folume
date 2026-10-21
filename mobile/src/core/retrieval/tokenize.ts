const STOP = new Set(
  (
    'the of and to in is that for with as on by this are from an be at which our can it or not has have we its ' +
    'these their was were been also into than then such each other using used use thus where when what ' +
    've bir bu için ile da de olarak daha çok gibi olan en kadar sonra ancak ise ya veya bunu şu her ne mi ' +
    'ama fakat hem ki'
  ).split(' '),
);

/** Lightweight stemming: enough to match plurals and common verb forms without a language-specific stemmer. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 5 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && (w.endsWith('ing') || w.endsWith('ed'))) w = w.slice(0, w.endsWith('ing') ? -3 : -2);
  else if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return w;
}

/** Lowercased word tokens (letters/digits of any script), stopwords removed, plus adjacent-pair tokens. */
export function tokenize(text: string, withBigrams = true): string[] {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\-']*/gu) ?? []).map((w) => w.replace(/^[-']+|[-']+$/g, ''));
  const kept = words.filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
  if (!withBigrams) return kept;
  const out = [...kept];
  for (let i = 0; i + 1 < kept.length; i++) out.push(`${kept[i]}_${kept[i + 1]}`);
  return out;
}
