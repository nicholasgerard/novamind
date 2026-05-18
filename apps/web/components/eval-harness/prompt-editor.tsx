"use client";

import { Editor, loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

loader.config({ monaco });

export interface PromptChangeHighlight {
  lineNumber: number;
  message: string;
  previous?: string;
}

export interface PromptEditorProps {
  value: string;
  baseline: string;
  onChange: (value: string) => void;
  onReset?: () => void;
  disabled?: boolean;
  actions?: ReactNode;
  changedLines?: ReadonlyArray<PromptChangeHighlight>;
  resetAvailable?: boolean;
}

type MonacoEditor = Parameters<OnMount>[0];
type Monaco = Parameters<OnMount>[1];

export function PromptEditor({
  value,
  baseline,
  onChange,
  onReset,
  disabled,
  actions,
  changedLines = [],
  resetAvailable,
}: PromptEditorProps) {
  const dirty = value !== baseline;
  const canReset = resetAvailable ?? dirty;
  const lineCount = value.split("\n").length;
  const editorRef = useRef<MonacoEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationIdsRef = useRef<string[]>([]);

  const handleMount = useCallback<OnMount>((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    decorationIdsRef.current = editor.deltaDecorations(
      decorationIdsRef.current,
      changedLines.map((line) => ({
        range: new monaco.Range(line.lineNumber, 1, line.lineNumber, 1),
        options: {
          isWholeLine: true,
          className: "prompt-editor-line-changed",
          glyphMarginClassName: "prompt-editor-glyph-changed",
          linesDecorationsClassName: "prompt-editor-line-marker",
          hoverMessage: [
            {
              value: line.previous
                ? `${line.message}\n\nPrevious: \`${line.previous}\``
                : line.message,
            },
          ],
        },
      })),
    );
  }, [changedLines]);

  return (
    <div className="panel flex h-full min-h-0 flex-col overflow-hidden rounded-lg">
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className="truncate font-semibold uppercase tracking-wider text-muted-foreground">
            Hypothesis system prompt
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="shrink-0 text-muted-foreground">
            {lineCount} lines
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (onReset ? onReset() : onChange(baseline))}
            disabled={!canReset || disabled}
          >
            <RotateCcw className="size-3" />
            <span className="hidden sm:inline">Reset</span>
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {(dirty || changedLines.length > 0) && (
          <div className="pointer-events-none absolute right-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap justify-end gap-1.5">
            {dirty && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border border-primary/25 bg-background/85 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary shadow-lg shadow-black/20 backdrop-blur-xl",
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Edited
              </span>
            )}
            {changedLines.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--positive)]/30 bg-background/85 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--positive)] shadow-lg shadow-black/20 backdrop-blur-xl">
                {changedLines.length} changed line
                {changedLines.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
        <Editor
          value={value}
          onChange={(v) => onChange(v ?? "")}
          theme="vs-dark"
          defaultLanguage="markdown"
          height="100%"
          onMount={handleMount}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
            wordWrap: "on",
            wrappingIndent: "indent",
            scrollBeyondLastLine: false,
            renderLineHighlight: "line",
            lineNumbers: "on",
            glyphMargin: true,
            lineDecorationsWidth: 12,
            padding: { top: 12, bottom: 12 },
            readOnly: disabled,
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
}
