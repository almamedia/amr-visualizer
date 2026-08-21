import { Player } from "@remotion/player";
import { useEffect, useMemo, useState } from "react";
import type { BrandCard, CopyVariant } from "@/lib/types";
import {
  getVideoFormat,
  VIDEO_DURATION_FRAMES,
  VIDEO_DURATION_SECONDS,
  VIDEO_FORMATS,
  VIDEO_FPS,
  type VideoFormatId,
} from "@/lib/video/formats";
import { toVideoAdProps } from "@/lib/video/props";
import { VideoAd } from "@/lib/video/video-ad";

type RenderedVideo = {
  url: string;
  filename: string;
  bytes: number;
  passed: boolean;
  maxBytes: number;
};

const MAX_PREVIEW_WIDTH = 760;
const MAX_PREVIEW_HEIGHT = 520;

export function VideoDemo({
  brand,
  copy,
}: {
  brand: BrandCard;
  copy: CopyVariant;
}) {
  const [formatId, setFormatId] = useState<VideoFormatId>("paraati");
  const [rendered, setRendered] = useState<RenderedVideo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const format = getVideoFormat(formatId);
  const previewMaxWidth = Math.min(
    MAX_PREVIEW_WIDTH,
    (MAX_PREVIEW_HEIGHT * format.width) / format.height
  );
  const inputProps = useMemo(
    () => toVideoAdProps(brand, copy, formatId),
    [brand, copy, formatId]
  );

  useEffect(() => {
    return () => {
      if (rendered) URL.revokeObjectURL(rendered.url);
    };
  }, [rendered]);

  async function renderMp4() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/video", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brand, copy, formatId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Rendering the video failed.");
      }
      const blob = await response.blob();
      const next: RenderedVideo = {
        url: URL.createObjectURL(blob),
        filename:
          response.headers.get("x-amr-video-filename") ?? "amr-video-ad.mp4",
        bytes: Number(response.headers.get("x-amr-video-bytes") ?? blob.size),
        passed: response.headers.get("x-amr-video-passed") === "true",
        maxBytes: Number(response.headers.get("x-amr-video-max-bytes") ?? 0),
      };
      setRendered(next);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Rendering the video failed."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card video-demo">
      <div className="card-bar green" />
      <div className="card-body">
        <span className="eyebrow">Remotion demo</span>
        <h2>A 10-second ad from the same material</h2>
        <p className="sub">
          Preview the selected copy as motion, then render a silent H.264 MP4 in
          an Alma-approved video placement.
        </p>

        <div className="video-format-tabs" aria-label="Video format">
          {VIDEO_FORMATS.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={`goal ${formatId === candidate.id ? "selected" : ""}`}
              aria-pressed={formatId === candidate.id}
              onClick={() => {
                setFormatId(candidate.id);
                setRendered(null);
              }}
            >
              {candidate.name}
              <small>
                {candidate.width}×{candidate.height} px
              </small>
            </button>
          ))}
        </div>

        <div className="video-player-shell">
          <Player
            component={VideoAd}
            inputProps={inputProps}
            durationInFrames={VIDEO_DURATION_FRAMES}
            compositionWidth={format.width}
            compositionHeight={format.height}
            fps={VIDEO_FPS}
            controls
            loop
            style={{
              width: "100%",
              maxWidth: previewMaxWidth,
              aspectRatio: `${format.width} / ${format.height}`,
            }}
          />
        </div>

        <div className="video-demo-footer">
          <div>
            <strong>{format.name}</strong>
            <span>
              {format.width}×{format.height} px · {VIDEO_DURATION_SECONDS} s · 30
              fps · H.264
            </span>
          </div>
          <button type="button" onClick={renderMp4} disabled={busy}>
            {busy && <span className="spinner" />}
            {busy ? "Rendering MP4…" : "Render MP4"}
          </button>
        </div>

        {error ? (
          <div className="notice err video-render-notice">{error}</div>
        ) : null}

        {rendered ? (
          <div className="video-render-result">
            <video src={rendered.url} controls playsInline />
            <div>
              <span
                className={`badge ${rendered.passed ? "ok" : "attention"}`}
              >
                {rendered.passed ? "Passed video limits" : "Needs attention"}
              </span>
              <p>
                {rendered.filename} · {Math.round(rendered.bytes / 1024)} kB
                {rendered.maxBytes
                  ? ` / ${Math.round(rendered.maxBytes / 1024 / 1024)} MB max`
                  : ""}
              </p>
              <a href={rendered.url} download={rendered.filename}>
                <button type="button" className="outline tiny">
                  Download MP4
                </button>
              </a>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
