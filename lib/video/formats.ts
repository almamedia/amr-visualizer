import { getFormat, specs } from "../specs";

/** The first demo deliberately covers a wide, a tall and a compact placement. */
export const VIDEO_FORMAT_IDS = [
  "paraati",
  "suurtaulu",
  "boksit-crossdevice",
] as const;

export type VideoFormatId = (typeof VIDEO_FORMAT_IDS)[number];

export type VideoFormat = {
  id: VideoFormatId;
  name: string;
  width: number;
  height: number;
  maxFileSizeMb: number;
  maxDurationSeconds: number;
};

export const VIDEO_DURATION_SECONDS = 10;
export const VIDEO_FPS = 30;
export const VIDEO_DURATION_FRAMES = VIDEO_DURATION_SECONDS * VIDEO_FPS;

export const VIDEO_FORMATS: VideoFormat[] = VIDEO_FORMAT_IDS.map((id) => {
  const format = getFormat(id);
  if (!format.acceptedTypes.includes("video")) {
    throw new Error(`${format.name} is not approved for video.`);
  }
  return {
    id,
    name: format.name,
    width: format.width,
    height: format.height,
    maxFileSizeMb: specs.video.maxFileSizeMb,
    maxDurationSeconds: specs.video.maxDurationSeconds,
  };
});

export function isVideoFormatId(value: unknown): value is VideoFormatId {
  return VIDEO_FORMAT_IDS.includes(value as VideoFormatId);
}

export function getVideoFormat(id: VideoFormatId): VideoFormat {
  const format = VIDEO_FORMATS.find((candidate) => candidate.id === id);
  if (!format) throw new Error(`Unknown video format: ${id}`);
  return format;
}
