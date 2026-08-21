import { useEffect, useRef, useState } from "react";
import {
  closestContentTypes,
  resolveContentTypePicks,
  searchContentTypes,
} from "@/lib/content-taxonomy";

export function ContentTypeSelect({
  value,
  alternatives,
  onChange,
}: {
  value: string;
  alternatives: string[];
  onChange: (next: {
    contentType: string;
    contentTypeAlternatives: string[];
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"picks" | "browse">("picks");
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        close();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open && mode === "browse") searchRef.current?.focus();
  }, [open, mode]);

  function close() {
    setOpen(false);
    setMode("picks");
    setQuery("");
  }

  const picks = (alternatives ?? [])
    .filter((n) => n && n !== value)
    .slice(0, 4);
  const results = searchContentTypes(query);

  function apply(name: string, nextAlts?: string[]) {
    onChange(
      resolveContentTypePicks(
        name,
        nextAlts ?? closestContentTypes(name, 4, [value])
      )
    );
    close();
  }

  return (
    <div className="content-type" ref={rootRef}>
      <button
        type="button"
        id="content-type"
        className="content-type-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          setOpen(true);
          setMode("picks");
        }}
      >
        <span className={value ? "" : "placeholder"}>
          {value || "Choose a content type"}
        </span>
        <span className="content-type-chevron" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <div
          className="content-type-menu"
          role="listbox"
          aria-label="Content type"
        >
          {mode === "picks" ? (
            <>
              {picks.map((name) => (
                <button
                  type="button"
                  key={name}
                  role="option"
                  className="content-type-option"
                  onClick={() =>
                    apply(name, [value, ...picks.filter((p) => p !== name)])
                  }
                >
                  {name}
                </button>
              ))}
              {picks.length === 0 && (
                <p className="content-type-empty">
                  No close alternatives — pick something else from the list.
                </p>
              )}
              <button
                type="button"
                className="content-type-option else"
                onClick={() => setMode("browse")}
              >
                Something else
              </button>
            </>
          ) : (
            <>
              <input
                ref={searchRef}
                type="text"
                className="content-type-search"
                placeholder="Search content types"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search content types"
              />
              <div className="content-type-results">
                {results.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    role="option"
                    aria-selected={c.name === value}
                    className={`content-type-option ${
                      c.name === value ? "current" : ""
                    }`}
                    onClick={() => apply(c.name)}
                  >
                    <span>{c.name}</span>
                    {c.path !== c.name && <small>{c.path}</small>}
                  </button>
                ))}
                {results.length === 0 && (
                  <p className="content-type-empty">
                    No matching content types.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
