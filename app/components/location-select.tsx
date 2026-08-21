import { useEffect, useRef, useState } from "react";
import {
  GLOBAL_LOCATION,
  closestLocations,
  parseLocation,
  resolveLocationPicks,
  searchLocations,
} from "@/lib/geography";

export function LocationSelect({
  id,
  value,
  alternatives,
  onChange,
}: {
  id?: string;
  value: string;
  alternatives: string[];
  onChange: (next: {
    location: string;
    locationAlternatives: string[];
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

  const picks = (() => {
    const seen = new Set([value.trim().toLowerCase()]);
    const out: string[] = [];
    for (const name of [...alternatives, GLOBAL_LOCATION]) {
      const n = name.trim();
      if (!n || seen.has(n.toLowerCase())) continue;
      seen.add(n.toLowerCase());
      out.push(n);
      if (out.length === 4) break;
    }
    return out;
  })();

  const results = searchLocations(query);
  const queryTrim = query.trim();
  const exactMatch = results.some(
    (r) => r.name.toLowerCase() === queryTrim.toLowerCase()
  );
  const showCustom =
    queryTrim.length > 1 &&
    queryTrim.toLowerCase() !== value.toLowerCase() &&
    !exactMatch;

  function apply(name: string, nextAlts?: string[]) {
    onChange(
      resolveLocationPicks(
        name,
        nextAlts ?? closestLocations(name, 4, [value])
      )
    );
    close();
  }

  return (
    <div className="content-type" ref={rootRef}>
      <button
        type="button"
        id={id}
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
          {value || "Choose a city, a country, or Global"}
        </span>
        <span className="content-type-chevron" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <div
          className="content-type-menu"
          role="listbox"
          aria-label="Where you operate"
        >
          {mode === "picks" ? (
            <>
              {picks.map((name) => {
                const loc = parseLocation(name);
                return (
                  <button
                    type="button"
                    key={name}
                    role="option"
                    className="content-type-option"
                    onClick={() =>
                      apply(name, [value, ...picks.filter((p) => p !== name)])
                    }
                  >
                    <span>{name}</span>
                    {loc.path ? <small>{loc.path}</small> : null}
                  </button>
                );
              })}
              {picks.length === 0 && (
                <p className="content-type-empty">
                  No close alternatives — pick a city, a country, or Global.
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
                placeholder="Search cities and countries"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search cities and countries"
              />
              <div className="content-type-results">
                {results.map((loc) => (
                  <button
                    type="button"
                    key={`${loc.kind}:${loc.name}`}
                    role="option"
                    aria-selected={loc.name === value}
                    className={`content-type-option ${
                      loc.name === value ? "current" : ""
                    }`}
                    onClick={() => apply(loc.name)}
                  >
                    <span>{loc.name}</span>
                    {loc.path !== loc.name && <small>{loc.path}</small>}
                  </button>
                ))}
                {showCustom && (
                  <button
                    type="button"
                    className="content-type-option else"
                    onClick={() => apply(queryTrim)}
                  >
                    Use “{queryTrim}”
                  </button>
                )}
                {results.length === 0 && !showCustom && (
                  <p className="content-type-empty">
                    No matching places. Type a city name to use it.
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
