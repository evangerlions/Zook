import { badRequest, payloadTooLarge } from "../shared/errors.ts";

const MAX_PIXELS = 24_000_000;
const MAX_SIDE = 12_000;
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
type ImageDimensions = { width: number; height: number };

export function boundedFeedbackImageDimensions(image: Buffer, mimeType: string): ImageDimensions {
  const dimensions = mimeType === "image/png" ? pngDimensions(image)
    : mimeType === "image/jpeg" ? jpegDimensions(image)
    : mimeType === "image/webp" ? webpDimensions(image)
    : undefined;
  if (!dimensions || !dimensions.width || !dimensions.height) {
    badRequest("REQ_INVALID_BODY", "Feedback attachment image header is invalid.");
  }
  const { width, height } = dimensions;
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    payloadTooLarge("REQ_INVALID_BODY", "Feedback attachment dimensions are too large.");
  }
  return dimensions;
}

function pngDimensions(image: Buffer): ImageDimensions | undefined {
  if (image.length < 33 || !image.subarray(0, 8).equals(PNG_HEADER) ||
      image.readUInt32BE(8) !== 13 || image.toString("ascii", 12, 16) !== "IHDR") return;
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}

function jpegDimensions(image: Buffer): ImageDimensions | undefined {
  if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8) return;
  let offset = 2;
  while (offset < image.length) {
    if (image[offset++] !== 0xff) return;
    while (image[offset] === 0xff) offset += 1;
    const marker = image[offset++];
    if (marker === undefined || marker === 0xda || marker === 0xd9 || offset + 2 > image.length) return;
    const length = image.readUInt16BE(offset);
    if (length < 2 || offset + length > image.length) return;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      if (length < 8) return;
      return { width: image.readUInt16BE(offset + 5), height: image.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
}

function webpDimensions(image: Buffer): ImageDimensions | undefined {
  if (image.length < 25 || image.toString("ascii", 0, 4) !== "RIFF" ||
      image.toString("ascii", 8, 12) !== "WEBP") return;
  const containerEnd = image.readUInt32LE(4) + 8;
  const chunk = image.toString("ascii", 12, 16);
  const size = image.readUInt32LE(16);
  if (containerEnd > image.length || 20 + size > containerEnd) return;
  if (chunk === "VP8X" && size >= 10) {
    return { width: 1 + image.readUIntLE(24, 3), height: 1 + image.readUIntLE(27, 3) };
  }
  if (chunk === "VP8L" && size >= 5 && image[20] === 0x2f) {
    const bits = image.readUInt32LE(21);
    if ((bits >>> 29) !== 0) return;
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (chunk === "VP8 " && size >= 10 && (image[20]! & 1) === 0 &&
      image[23] === 0x9d && image[24] === 0x01 && image[25] === 0x2a) {
    return { width: image.readUInt16LE(26) & 0x3fff, height: image.readUInt16LE(28) & 0x3fff };
  }
}
