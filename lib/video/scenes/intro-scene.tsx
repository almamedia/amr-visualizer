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

export function IntroScene({
  companyName,
  logoUrl,
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
          name="Brand image"
          src={imageUrl}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            scale: interpolate(frame, [0, 4 * fps], [1.14, 1.04], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              output: "perceptual-scale",
            }),
            translate: interpolate(
              frame,
              [0, 4 * fps],
              ["0px 0px", `${Math.round(-width * 0.025)}px 0px`],
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
              "linear-gradient(90deg, rgba(28,10,25,.78), rgba(28,10,25,.14))",
          }}
        />
      ) : null}
      <MotionAccents accent={colors.accent} sceneDurationInFrames={105} />
      <Interactive.Div
        name="Intro accent rail"
        style={{
          position: "absolute",
          top: 0,
          right: tall ? Math.round(width * 0.08) : Math.round(width * 0.055),
          width: Math.max(4, Math.round(Math.min(width, height) * 0.018)),
          height: interpolate(frame, [0.15 * fps, 1.05 * fps], [0, height], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          backgroundColor: colors.accent,
          boxShadow: `0 0 ${Math.round(
            Math.min(width, height) * 0.08
          )}px ${colors.accent}`,
          opacity: 0.9,
        }}
      />
      <Interactive.Div
        name="Brand lockup"
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          bottom: pad,
          display: "flex",
          flexDirection: tall ? "column" : "row",
          alignItems: tall ? "flex-start" : "center",
          gap: Math.round(Math.min(width, height) * 0.04),
          color: textColor,
          opacity: interpolate(frame, [0, 1 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(
            frame,
            [0, 1 * fps],
            ["0px 28px", "0px 0px"],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }
          ),
          clipPath: `inset(0 ${interpolate(
            frame,
            [0, 0.9 * fps],
            [100, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }
          )}% 0 0)`,
        }}
      >
        {logoUrl ? (
          <Interactive.Div
            name="Logo plate"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: tall ? width * 0.52 : width * 0.22,
              height: tall ? height * 0.13 : height * 0.2,
              padding: Math.round(Math.min(width, height) * 0.018),
              borderRadius: Math.round(Math.min(width, height) * 0.025),
              backgroundColor: "rgba(255,255,255,.94)",
              boxShadow: imageUrl ? "0 8px 28px rgba(0,0,0,.22)" : undefined,
              scale: interpolate(frame, [0.1 * fps, 0.9 * fps], [0.72, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.spring({ damping: 170, stiffness: 170 }),
                output: "perceptual-scale",
              }),
              rotate: interpolate(frame, [0.1 * fps, 0.9 * fps], ["-5deg", "0deg"], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.spring({ damping: 170, stiffness: 170 }),
              }),
            }}
          >
            <Img
              name="Logo"
              src={logoUrl}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
            />
          </Interactive.Div>
        ) : null}
        <Interactive.Div
          name="Company name"
          style={{
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: Math.round(
              Math.min(width * (tall ? 0.11 : 0.055), height * 0.2)
            ),
            fontWeight: 800,
            lineHeight: 0.95,
            letterSpacing: "-0.04em",
            textShadow: imageUrl
              ? "0 2px 18px rgba(0,0,0,.32)"
              : undefined,
          }}
        >
          {companyName}
        </Interactive.Div>
      </Interactive.Div>
    </AbsoluteFill>
  );
}
