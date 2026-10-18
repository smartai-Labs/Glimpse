import { searchHighlights } from '../lib/tabSearch';
export function HighlightedText({ text, query }: { text: string; query: string }) {
  const ranges = searchHighlights(text, query);
  if (!ranges.length) return text;
  return <>{ranges.map(([start, stop], index) => <span key={start}>{text.slice(index ? ranges[index - 1][1] : 0, start)}<mark>{text.slice(start, stop)}</mark></span>)}{text.slice(ranges.at(-1)![1])}</>;
}
