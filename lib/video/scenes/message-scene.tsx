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

export function MessageScene({
  headline,
  body,
  imageUrl,
  colors,
}: VideoAdProps) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const tall = height > width;
  const pad = Math.round(Math.min(width, height) * 0.08);
  const textColor = imageUrl ? "#ffffff" : readableText(colors.primary);

  return (
    <AbsoluteFill
      style={{ backgroundColor: colors.primary, overflow: "hidden" }}
    >
      {imageUrl ? (
        <Img
          name="Message image"
          src={imageUrl}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            scale: interpolate(frame, [0, 4 * fps], [1.13, 1.045], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              output: "perceptual-scale",
            }),
            translate: interpolate(
              frame,
              [0, 4 * fps],
              [`${Math.round(width * 0.025)}px 0px`, `${Math.round(-width * 0.02)}px 0px`],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }
            ),
          }}
        />
      ) : null}
      {imageUrl ? (
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(90deg, rgba(28,10,25,.9), rgba(28,10,25,.35))",
          }}
        />
      ) : null}
      <MotionAccents accent={colors.accent} sceneDurationInFrames={105} />
      <Interactive.Div
        name="Kinetic diagonal"
        style={{
          position: "absolute",
          width: Math.max(24, Math.round(Math.min(width, height) * 0.12)),
          height: height * 1.7,
          right: tall ? width * 0.03 : width * 0.12,
          top: -height * 0.32,
          backgroundColor: colors.accent,
          opacity: imageUrl ? 0.24 : 0.34,
          rotate: "17deg",
          translate: interpolate(
            frame,
            [0, 1.1 * fps],
            [`${Math.round(width * 0.3)}px 0px`, "0px 0px"],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.spring({ damping: 190, stiffness: 150 }),
            }
          ),
        }}
      />
      <Interactive.Div
        name="Message"
        style={{
          position: "absolute",
          inset: pad,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          color: textColor,
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <Interactive.Div
          name="Headline marker"
          style={{
            width: interpolate(
              frame,
              [0.1 * fps, 0.75 * fps],
              [0, tall ? width * 0.24 : width * 0.11],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }
            ),
            height: Math.max(5, Math.round(Math.min(width, height) * 0.018)),
            marginBottom: Math.round(Math.min(width, height) * 0.045),
            borderRadius: 999,
            backgroundColor: colors.accent,
            boxShadow: `0 0 ${Math.round(
              Math.min(width, height) * 0.06
            )}px ${colors.accent}`,
          }}
        />
        <Interactive.Div
          name="Headline"
          style={{
            maxWidth: tall ? "100%" : "72%",
            fontSize: Math.round(
              Math.min(width * (tall ? 0.115 : 0.065), height * 0.19)
            ),
            fontWeight: 800,
            lineHeight: 0.95,
            letterSpacing: "-0.045em",
            textWrap: "balance",
            opacity: interpolate(frame, [0, 0.7 * fps], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            translate: interpolate(
              frame,
              [0, 0.7 * fps],
              ["0px 32px", "0px 0px"],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }
            ),
            scale: interpolate(frame, [0, 0.85 * fps], [0.94, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.spring({ damping: 190, stiffness: 150 }),
              output: "perceptual-scale",
            }),
          }}
        >
          {headline}
        </Interactive.Div>
        {body ? (
          <Interactive.Div
            name="Body copy"
            style={{
              maxWidth: tall ? "100%" : "62%",
              marginTop: Math.round(Math.min(width, height) * 0.05),
              fontSize: Math.round(
                Math.min(width * (tall ? 0.05 : 0.027), height * 0.075)
              ),
              fontWeight: 400,
              lineHeight: 1.18,
              opacity: interpolate(
                frame,
                [0.55 * fps, 1.25 * fps],
                [0, 1],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }
              ),
              translate: interpolate(
                frame,
                [0.55 * fps, 1.25 * fps],
                ["0px 20px", "0px 0px"],
                {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.bezier(0.16, 1, 0.3, 1),
                }
              ),
            }}
          >
            {body}
          </Interactive.Div>
        ) : null}
      </Interactive.Div>
    </AbsoluteFill>
  );
}
