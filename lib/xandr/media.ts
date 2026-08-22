/**
 * POST /creative-upload — hosting an image with Xandr.
 *
 * This is the only call that needs member_id, and the only one that sends
 * multipart rather than JSON. Xandr accepts jpeg, jpg, gif and png; the studio
 * renders PNG and JPEG, so anything else is a mistake upstream and is reported
 * as a warning rather than aborting the booking.
 */

import { advertiserId as configuredAdvertiserId, memberId } from "./config";
import { request } from "./client";
import type { MediaAsset, MediaUploadResponse } from "./types";

const UPLOAD_TIMEOUT_MS = 60_000;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
};

export interface DecodedImage {
  bytes: Buffer;
  mime: string;
  ext: string;
}

/**
 * Split a `data:image/png;base64,...` URI. Returns null when the URI is not a
 * base64 image Xandr will host.
 */
export function decodeDataUri(dataUri: string): DecodedImage | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUri);
  if (!match) return null;

  const mime = match[1].toLowerCase();
  const ext = EXT_BY_MIME[mime];
  if (!ext) return null;

  const bytes = Buffer.from(match[2], "base64");
  if (bytes.byteLength === 0) return null;

  return { bytes, mime, ext };
}

/** Upload one image and return the hosted asset. */
export async function uploadImage(
  image: DecodedImage,
  fileName: string,
  advertiser?: number
): Promise<MediaAsset> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(image.bytes)], { type: image.mime }), fileName);
  form.append("type", "image");

  const response = await request<MediaUploadResponse>({
    method: "POST",
    service: "creative-upload",
    params: {
      member_id: memberId(),
      advertiser_id: advertiser ?? configuredAdvertiserId(),
    },
    form,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });

  const asset = response["media-asset"]?.[0];
  if (!asset?.cdn_secure_url) {
    throw new Error(`Xandr accepted ${fileName} but returned no media asset.`);
  }
  return asset;
}
