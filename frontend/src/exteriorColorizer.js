const SEGMENTATION_MODEL = "Xenova/segformer-b0-finetuned-ade-512-512";
let segmenterPromise;

async function getSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = import("@huggingface/transformers").then(({ pipeline }) =>
      pipeline("image-segmentation", SEGMENTATION_MODEL, {
        dtype: "q8",
      })
    );
  }

  try {
    return await segmenterPromise;
  } catch (error) {
    segmenterPromise = undefined;
    throw error;
  }
}

async function segmentCanvas(canvas) {
  const segmenter = await getSegmenter();
  const { RawImage } = await import("@huggingface/transformers");
  const image = RawImage.fromCanvas(canvas);
  return segmenter(image, {
    target_sizes: [[image.height, image.width]],
  });
}

function addMask(target, source, sourceWidth, sourceHeight, width, height) {
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(
      sourceHeight - 1,
      Math.floor((y * sourceHeight) / height)
    );
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(
        sourceWidth - 1,
        Math.floor((x * sourceWidth) / width)
      );
      if (source[sourceY * sourceWidth + sourceX] > 127) {
        target[y * width + x] = 255;
      }
    }
  }
}

export async function detectPaintedHouseMask(canvas) {
  const detections = await segmentCanvas(canvas);
  const { width, height } = canvas;
  const mask = new Uint8Array(width * height);
  const buildingLabels = new Set([
    "building",
    "house",
    "wall",
    "roof",
    "column",
    "skyscraper",
  ]);

  detections.forEach(({ label, mask: detectionMask }) => {
    if (!buildingLabels.has(label?.trim().toLowerCase())) return;
    addMask(
      mask,
      detectionMask.data,
      detectionMask.width,
      detectionMask.height,
      width,
      height
    );
  });

  if (!mask.some((pixel) => pixel > 0)) {
    throw new Error(
      "Could not identify the house in this photo. Try a clearer, front-facing house image."
    );
  }

  return mask;
}

function createBorderMask(wallMask, width, height) {
  const borderMask = new Uint8Array(wallMask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const pixel = y * width + x;
      if (
        wallMask[pixel] &&
        (!wallMask[pixel - width] ||
          !wallMask[pixel + width] ||
          !wallMask[pixel - 1] ||
          !wallMask[pixel + 1])
      ) {
        borderMask[pixel] = 255;
      }
    }
  }
  return borderMask;
}

export async function detectExteriorSurfaces(canvas) {
  const detections = await segmentCanvas(canvas);
  const { width, height } = canvas;
  const masks = {
    walls: new Uint8Array(width * height),
    borders: new Uint8Array(width * height),
    windows: new Uint8Array(width * height),
    doors: new Uint8Array(width * height),
    gates: new Uint8Array(width * height),
  };
  const fallbackWallMask = new Uint8Array(width * height);

  detections.forEach(({ label, mask }) => {
    const normalizedLabel = label?.trim().toLowerCase();
    if (normalizedLabel === "building" || normalizedLabel === "house") {
      addMask(
        fallbackWallMask,
        mask.data,
        mask.width,
        mask.height,
        width,
        height
      );
    }
    const target =
      normalizedLabel === "wall"
        ? masks.walls
        : normalizedLabel === "windowpane"
          ? masks.windows
          : normalizedLabel === "door" || normalizedLabel === "screen door"
            ? masks.doors
            : normalizedLabel === "fence" || normalizedLabel === "railing"
              ? masks.gates
              : null;
    if (target) {
      addMask(
        target,
        mask.data,
        mask.width,
        mask.height,
        width,
        height
      );
    }
  });

  if (!masks.walls.some((pixel) => pixel > 0)) {
    masks.walls = fallbackWallMask;
  }

  if (!masks.walls.some((pixel) => pixel > 0) &&
      !masks.windows.some((pixel) => pixel > 0) &&
      !masks.doors.some((pixel) => pixel > 0) &&
      !masks.gates.some((pixel) => pixel > 0)) {
    throw new Error("No paintable house surfaces were detected in this photo.");
  }

  masks.borders = createBorderMask(masks.walls, width, height);
  return masks;
}

export function applyExteriorColours(
  imagePixels,
  masks,
  colours,
  opacity = 0.58
) {
  const { width, height, pixels } = imagePixels;
  const output = new Uint8ClampedArray(pixels);
  const surfaces = ["walls", "borders", "windows", "doors", "gates"];

  surfaces.forEach((surface) => {
    const mask = masks[surface];
    const hex = colours[surface].slice(1);
    const tint = [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];

    for (let pixel = 0; pixel < width * height; pixel += 1) {
      if (!mask[pixel]) continue;
      const offset = pixel * 4;
      const pixelOpacity = opacity * (mask[pixel] / 255);
      output[offset] =
        pixels[offset] * (1 - pixelOpacity) + tint[0] * pixelOpacity;
      output[offset + 1] =
        pixels[offset + 1] * (1 - pixelOpacity) +
        tint[1] * pixelOpacity;
      output[offset + 2] =
        pixels[offset + 2] * (1 - pixelOpacity) +
        tint[2] * pixelOpacity;
    }
  });

  return new ImageData(output, width, height);
}
