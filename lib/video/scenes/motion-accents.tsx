import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export function MotionAccents({
  accent,
  sceneDurationInFrames,
}: {
  accent: string;
  sceneDurationInFrames: number;
}) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const size = Math.max(width, height) * 0.62;

  return (
    <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none" }}>
      <Interactive.Div
        name="Moving accent glow"
        style={{
          position: "absolute",
          width: size,
          height: size,
          right: -size * 0.28,
          top: -size * 0.34,
          borderRadius: "50%",
          backgroundColor: accent,
          filter: `blur(${Math.round(Math.min(width, height) * 0.055)}px)`,
          opacity: interpolate(
            frame,
            [
              0,
              0.7 * fps,
              sceneDurationInFrames - 0.6 * fps,
              sceneDurationInFrames,
            ],
            [0, 0.24, 0.24, 0],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: [
                Easing.bezier(0.16, 1, 0.3, 1),
                Easing.linear,
                Easing.bezier(0.7, 0, 0.84, 0),
              ],
            }
          ),
          scale: interpolate(frame, [0, sceneDurationInFrames], [0.72, 1.18], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            output: "perceptual-scale",
          }),
          translate: interpolate(
            frame,
            [0, sceneDurationInFrames],
            ["0px 0px", `${Math.round(-width * 0.08)}px ${Math.round(
              height * 0.12
            )}px`],
            {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }
          ),
        }}
      />
      <Interactive.Div
        name="Orbit ring"
        style={{
          position: "absolute",
          width: size * 0.74,
          height: size * 0.74,
          right: -size * 0.18,
          top: -size * 0.2,
          borderRadius: "50%",
          border: `${Math.max(1, Math.round(Math.min(width, height) * 0.006))}px solid rgba(255,255,255,.34)`,
          opacity: interpolate(frame, [0.25 * fps, 0.85 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          scale: interpolate(frame, [0, sceneDurationInFrames], [0.8, 1.08], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            output: "perceptual-scale",
          }),
          rotate: interpolate(frame, [0, sceneDurationInFrames], ["-12deg", "22deg"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />
    </AbsoluteFill>
  );
}
