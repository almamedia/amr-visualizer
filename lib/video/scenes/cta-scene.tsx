import {
  AbsoluteFill,
  Easing,
  Img,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { readableText } from "../palette";
import type { VideoAdProps } from "../schema";
import { MotionAccents } from "./motion-accents";

export function CtaScene({
  companyName,
  cta,
  logoUrl,
  colors,
}: VideoAdProps) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const tall = height > width;
  const pad = Math.round(Math.min(width, height) * 0.08);
  const groundText = readableText(colors.primary);
  const buttonText = readableText(colors.accent);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.primary,
        color: groundText,
        fontFamily: "Arial, Helvetica, sans-serif",
        padding: pad,
        display: "flex",
        flexDirection: tall ? "column" : "row",
        alignItems: tall ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: pad,
        overflow: "hidden",
      }}
    >
      <MotionAccents accent={colors.accent} sceneDurationInFrames={120} />
      <Interactive.Div
        name="Finale halo"
        style={{
          position: "absolute",
          width: Math.max(width, height) * 0.72,
          height: Math.max(width, height) * 0.72,
          right: tall ? -width * 0.62 : -width * 0.08,
          bottom: tall ? -height * 0.09 : -height * 0.72,
          borderRadius: "50%",
          border: `${Math.max(
            2,
            Math.round(Math.min(width, height) * 0.012)
          )}px solid rgba(255,255,255,.38)`,
          opacity: interpolate(frame, [0, 0.8 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          scale: interpolate(frame, [0, 3.5 * fps], [0.62, 1.08], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            output: "perceptual-scale",
          }),
        }}
      />
      <Interactive.Div
        name="Final brand"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: Math.round(Math.min(width, height) * 0.035),
          maxWidth: tall ? "100%" : "46%",
          opacity: interpolate(frame, [0, 0.8 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(
            frame,
            [0, 0.9 * fps],
            [tall ? "0px 34px" : "-42px 0px", "0px 0px"],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.spring({ damping: 190, stiffness: 150 }),
            }
          ),
        }}
      >
        {logoUrl ? (
          <Interactive.Div
            name="Final logo plate"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: tall ? width * 0.58 : width * 0.25,
              height: tall ? height * 0.14 : height * 0.24,
              padding: Math.round(Math.min(width, height) * 0.018),
              borderRadius: Math.round(Math.min(width, height) * 0.025),
              backgroundColor: "rgba(255,255,255,.94)",
            }}
          >
            <Img
              name="Final logo"
              src={logoUrl}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
          </Interactive.Div>
        ) : null}
        <Interactive.Div
          name="Final company name"
          style={{
            fontSize: Math.round(
              Math.min(width * (tall ? 0.1 : 0.05), height * 0.17)
            ),
            fontWeight: 800,
            lineHeight: 0.95,
            letterSpacing: "-0.04em",
          }}
        >
          {companyName}
        </Interactive.Div>
      </Interactive.Div>

      <Interactive.Div
        name="Call to action"
        style={{
          backgroundColor: colors.accent,
          color: buttonText,
          borderRadius: 999,
          padding: tall ? "18px 28px" : "16px 30px",
          fontSize: Math.round(
            Math.min(width * (tall ? 0.057 : 0.027), height * 0.085)
          ),
          fontWeight: 800,
          lineHeight: 1,
          whiteSpace: "nowrap",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          gap: Math.round(Math.min(width, height) * 0.025),
          boxShadow: "0 14px 34px rgba(0,0,0,.24)",
          scale: interpolate(frame, [0.5 * fps, 1.3 * fps], [0.82, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 200 }),
            output: "perceptual-scale",
          }),
          opacity: interpolate(frame, [0.5 * fps, 1 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(
            frame,
            [0.5 * fps, 1.2 * fps],
            [tall ? "0px 36px" : "42px 0px", "0px 0px"],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.spring({ damping: 170, stiffness: 170 }),
            }
          ),
        }}
      >
        <Interactive.Div
          name="CTA shine"
          style={{
            position: "absolute",
            top: "-35%",
            left: 0,
            width: "28%",
            height: "170%",
            backgroundColor: "rgba(255,255,255,.48)",
            filter: "blur(8px)",
            rotate: "18deg",
            translate: interpolate(
              frame,
              [1.15 * fps, 2.05 * fps],
              ["-180% 0px", "480% 0px"],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }
            ),
          }}
        />
        <span style={{ position: "relative" }}>{cta}</span>
        <Interactive.Span
          name="CTA arrow"
          style={{
            position: "relative",
            width: Math.round(Math.min(width, height) * 0.09),
            height: Math.round(Math.min(width, height) * 0.09),
            minWidth: Math.round(Math.min(width, height) * 0.09),
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: buttonText,
            color: colors.accent,
            fontSize: Math.round(Math.min(width, height) * 0.055),
            opacity: interpolate(frame, [0.9 * fps, 1.45 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            translate: interpolate(
              frame,
              [0.9 * fps, 1.45 * fps],
              ["-16px 0px", "0px 0px"],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.spring({ damping: 180, stiffness: 160 }),
              }
            ),
          }}
        >
          →
        </Interactive.Span>
      </Interactive.Div>
    </AbsoluteFill>
  );
}
