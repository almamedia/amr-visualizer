import type { CalculateMetadataFunction } from "remotion";
import { Composition } from "remotion";
import {
  getVideoFormat,
  VIDEO_DURATION_FRAMES,
  VIDEO_FPS,
} from "./formats";
import { videoAdSchema, type VideoAdProps } from "./schema";
import { VideoAd } from "./video-ad";

export const VIDEO_COMPOSITION_ID = "AMRVideoAd";

const calculateMetadata: CalculateMetadataFunction<VideoAdProps> = ({ props }) => {
  const format = getVideoFormat(props.formatId);
  return {
    width: format.width,
    height: format.height,
    fps: VIDEO_FPS,
    durationInFrames: VIDEO_DURATION_FRAMES,
  };
};

export function RemotionRoot() {
  const defaultFormat = getVideoFormat("paraati");

  return (
    <Composition
      id={VIDEO_COMPOSITION_ID}
      component={VideoAd}
      schema={videoAdSchema}
      calculateMetadata={calculateMetadata}
      width={defaultFormat.width}
      height={defaultFormat.height}
      fps={VIDEO_FPS}
      durationInFrames={VIDEO_DURATION_FRAMES}
      defaultProps={{
        formatId: "paraati",
        companyName: "Alma Media",
        headline: "Ideas become impact",
        body: "A ten-second advertising demo made from the same brand material.",
        cta: "Learn more",
        logoUrl: null,
        imageUrl: null,
        colors: {
          primary: "#9f248f",
          accent: "#28b78f",
          background: "#faf6f8",
          text: "#1c0a19",
        },
      }}
    />
  );
}
