import { zColor } from "@remotion/zod-types";
import { z } from "zod";
import { VIDEO_FORMAT_IDS } from "./formats";

export const videoAdSchema = z.object({
  formatId: z.enum(VIDEO_FORMAT_IDS),
  companyName: z.string(),
  headline: z.string(),
  body: z.string(),
  cta: z.string(),
  logoUrl: z.string().nullable(),
  imageUrl: z.string().nullable(),
  colors: z.object({
    primary: zColor(),
    accent: zColor(),
    background: zColor(),
    text: zColor(),
  }),
});

export type VideoAdProps = z.infer<typeof videoAdSchema>;
