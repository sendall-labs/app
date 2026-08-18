"use client";

import { useCallback, useMemo, useRef } from "react";

const CSV_HEADER = "destination,amount,memo";
const EXAMPLE_ROWS = [
  "GDM5TPUTB7A7UW4QJ5SGUVA7WVJCNOHZO5RZIYM2Y4B3MJQB3F6CGOC5,10",
  "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H,5.5,thanks",
].join("\n");

function nonEmptyLineCount(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

/** Strips a leading destination/amount header row, if the uploaded file has one. */
function stripHeaderIfPresent(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim().toLowerCase().replace(/\s/g, "") === CSV_HEADER) {
    return lines.slice(1).join("\n");
  }
  return text;
}

export { CSV_HEADER };

export function RecipientsEditor({
  value,
  onChange,
  onFileNameChange,
  onBlur,
  readOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  onFileNameChange?: (name: string | null) => void;
  onBlur?: () => void;
  readOnly?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const lineCount = Math.max(1, nonEmptyLineCount(value) || value.split(/\r?\n/).length);
  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1).join("\n"),
    [lineCount]
  );

  const syncGutterScroll = useCallback(() => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  const handleFilePicked = useCallback(
    async (file: File) => {
      const text = await file.text();
      onChange(stripHeaderIfPresent(text.trim()));
      onFileNameChange?.(file.name);
    },
    [onChange, onFileNameChange]
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-ink">Addresses with amounts</label>
        {!readOnly && (
          <div className="flex items-center gap-4 text-xs">
            <button
              type="button"
              onClick={() => {
                onChange(EXAMPLE_ROWS);
                onFileNameChange?.(null);
              }}
              className="text-accent hover:underline"
            >
              Show example
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-accent hover:underline"
            >
              Upload CSV
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFilePicked(file);
                e.target.value = "";
              }}
            />
          </div>
        )}
      </div>

      <div className="flex overflow-hidden rounded-md border border-hairline bg-paper focus-within:border-accent">
        <div
          ref={gutterRef}
          aria-hidden
          className="select-none overflow-hidden whitespace-pre px-3 py-2 text-right font-mono text-sm text-ink-faint"
        >
          {lineNumbers}
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            onFileNameChange?.(null);
          }}
          onBlur={onBlur}
          onScroll={syncGutterScroll}
          spellCheck={false}
          readOnly={readOnly}
          rows={8}
          placeholder={"GDM5TP...CGOC5,10\nGBRPYH...7OX2H,5.5,optional memo"}
          className="min-w-0 flex-1 resize-y bg-transparent px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
      </div>
      <p className="text-xs text-ink-faint">
        One recipient per line: <code>address,amount</code>, optional third column for a memo.
      </p>
    </div>
  );
}
