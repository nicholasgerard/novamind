import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type MarkdownTextProps = {
  className?: string;
  inlineCodeClassName?: string;
  itemClassName?: string;
  linkClassName?: string;
  listClassName?: string;
  paragraphClassName?: string;
  text: string;
};

type MarkdownBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string }
  | { items: string[]; kind: "ordered-list" | "unordered-list" };

const unorderedListPattern = /^\s*[-*+]\s+(.+)$/;
const orderedListPattern = /^\s*\d+[.)]\s+(.+)$/;
const quotePattern = /^\s*>\s?(.+)$/;
const inlinePattern =
  /(\*\*[^*\n]+?\*\*|`[^`\n]+?`|\[[^\]\n]+?\]\([^) \n]+?\)|\*[^*\n]+?\*)/g;

/**
 * Small safe Markdown renderer for model-authored chat text. It intentionally
 * implements only the subset we expect in demo output and lets React escape
 * all plain text instead of accepting raw HTML.
 */
export function MarkdownText({
  className,
  inlineCodeClassName,
  itemClassName,
  linkClassName,
  listClassName,
  paragraphClassName,
  text,
}: MarkdownTextProps) {
  const blocks = parseMarkdownBlocks(text);
  if (blocks.length === 0) return null;

  return (
    <div className={cn("space-y-2", className)}>
      {blocks.map((block, index) => {
        if (block.kind === "unordered-list") {
          return (
            <ul
              key={index}
              className={cn("ml-4 list-disc space-y-1", listClassName)}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className={itemClassName}>
                  {renderInlineMarkdown(item, {
                    inlineCodeClassName,
                    linkClassName,
                  })}
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === "ordered-list") {
          return (
            <ol
              key={index}
              className={cn("ml-4 list-decimal space-y-1", listClassName)}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className={itemClassName}>
                  {renderInlineMarkdown(item, {
                    inlineCodeClassName,
                    linkClassName,
                  })}
                </li>
              ))}
            </ol>
          );
        }
        if (block.kind === "quote") {
          return (
            <blockquote
              key={index}
              className={cn(
                "border-l border-border/80 pl-3 italic",
                paragraphClassName,
              )}
            >
              {renderInlineMarkdown(block.text, {
                inlineCodeClassName,
                linkClassName,
              })}
            </blockquote>
          );
        }
        if (block.kind === "paragraph") {
          return (
            <p key={index} className={paragraphClassName}>
              {renderInlineMarkdown(block.text, {
                inlineCodeClassName,
                linkClassName,
              })}
            </p>
          );
        }
        return null;
      })}
    </div>
  );
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = text.replace(/\r\n/g, "\n").trim().split("\n");
  let paragraph: string[] = [];
  let list:
    | { items: string[]; kind: "ordered-list" | "unordered-list" }
    | undefined;

  function flushParagraph() {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", text: paragraph.join("\n").trim() });
    paragraph = [];
  }

  function flushList() {
    if (!list) return;
    blocks.push(list);
    list = undefined;
  }

  for (const line of lines) {
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const unordered = unorderedListPattern.exec(line);
    if (unordered?.[1]) {
      flushParagraph();
      if (list?.kind !== "unordered-list") flushList();
      list ??= { items: [], kind: "unordered-list" };
      list.items.push(unordered[1]);
      continue;
    }

    const ordered = orderedListPattern.exec(line);
    if (ordered?.[1]) {
      flushParagraph();
      if (list?.kind !== "ordered-list") flushList();
      list ??= { items: [], kind: "ordered-list" };
      list.items.push(ordered[1]);
      continue;
    }

    const quote = quotePattern.exec(line);
    if (quote?.[1]) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "quote", text: quote[1].trim() });
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function renderInlineMarkdown(
  text: string,
  options: {
    inlineCodeClassName?: string;
    linkClassName?: string;
  },
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(inlinePattern)) {
    const [token] = match;
    const index = match.index ?? 0;
    if (index > lastIndex) {
      nodes.push(
        ...renderTextWithBreaks(text.slice(lastIndex, index), lastIndex),
      );
    }
    nodes.push(renderInlineToken(token, `token-${index}`, options));
    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(...renderTextWithBreaks(text.slice(lastIndex), lastIndex));
  }

  return nodes;
}

function renderInlineToken(
  token: string,
  key: string,
  options: {
    inlineCodeClassName?: string;
    linkClassName?: string;
  },
): ReactNode {
  if (token.startsWith("**") && token.endsWith("**")) {
    return <strong key={key}>{token.slice(2, -2)}</strong>;
  }
  if (token.startsWith("`") && token.endsWith("`")) {
    return (
      <code
        key={key}
        className={cn(
          "rounded border border-border/70 bg-background/60 px-1 py-0.5 font-mono text-[0.92em]",
          options.inlineCodeClassName,
        )}
      >
        {token.slice(1, -1)}
      </code>
    );
  }
  if (token.startsWith("[") && token.includes("](") && token.endsWith(")")) {
    const labelEnd = token.indexOf("](");
    const label = token.slice(1, labelEnd);
    const href = safeHref(token.slice(labelEnd + 2, -1));
    if (href) {
      return (
        <a
          key={key}
          href={href}
          rel="noopener noreferrer"
          target="_blank"
          className={cn("underline underline-offset-4", options.linkClassName)}
        >
          {label}
        </a>
      );
    }
    return <span key={key}>{label}</span>;
  }
  if (token.startsWith("*") && token.endsWith("*")) {
    return <em key={key}>{token.slice(1, -1)}</em>;
  }
  return token;
}

function renderTextWithBreaks(text: string, keyOffset: number): ReactNode[] {
  const lines = text.split("\n");
  return lines.flatMap((line, index) =>
    index === 0 ? [line] : [<br key={`br-${keyOffset}-${index}`} />, line],
  );
}

function safeHref(href: string): string | undefined {
  try {
    const parsed = new URL(href);
    if (["http:", "https:", "mailto:"].includes(parsed.protocol)) return href;
  } catch {
    return undefined;
  }
  return undefined;
}
