import { TransitionSeries, springTiming } from "@remotion/transitions";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { useVideoConfig } from "remotion";
import type { VideoAdProps } from "./schema";
import { CtaScene } from "./scenes/cta-scene";
import { IntroScene } from "./scenes/intro-scene";
import { MessageScene } from "./scenes/message-scene";

export function VideoAd(props: VideoAdProps) {
  const { fps, width, height } = useVideoConfig();
  const tall = height > width;

  return (
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={105} name="Brand intro">
        <IntroScene {...props} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={wipe({ direction: tall ? "from-bottom" : "from-right" })}
        timing={springTiming({
          durationInFrames: 0.5 * fps,
          config: { damping: 200 },
        })}
      />
      <TransitionSeries.Sequence durationInFrames={105} name="Campaign message">
        <MessageScene {...props} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={slide({ direction: tall ? "from-bottom" : "from-left" })}
        timing={springTiming({
          durationInFrames: 0.5 * fps,
          config: { damping: 180, stiffness: 160 },
        })}
      />
      <TransitionSeries.Sequence durationInFrames={120} name="Call to action">
        <CtaScene {...props} />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
}
