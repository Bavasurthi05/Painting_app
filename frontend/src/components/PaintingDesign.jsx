
import React, { useEffect, useRef, useState } from "react";
import "./PaintingDesign.css";
import {
  applyExteriorColours,
  detectPaintedHouseMask,
  detectExteriorSurfaces,
} from "../exteriorColorizer";

const DESIGNS = [
  {
    id: "rose-pink",
    name: "Vibrant Pink & Ivory",
    wall: "#E85D8F",
    wallName: "vibrant rose pink",
    trim: "#FFF0E3",
    trimName: "warm ivory",
    description: "Color-rich rose-pink walls with warm ivory trim",
  },
  {
    id: "purple-yellow",
    name: "Royal Purple & Gold",
    wall: "#8957C8",
    wallName: "rich royal purple",
    trim: "#F4C95D",
    trimName: "bright golden yellow",
    description: "Rich purple walls paired with sunny golden-yellow trim",
  },
  {
    id: "green-brown",
    name: "Garden Green & Brown",
    wall: "#69A84F",
    wallName: "bright garden green",
    trim: "#914E35",
    trimName: "warm terracotta brown",
    description: "Fresh green walls with grounded terracotta-brown trim",
  },
  {
    id: "blue-yellow",
    name: "Clear Blue & Sunshine",
    wall: "#328CC1",
    wallName: "clear bright blue",
    trim: "#FFF1CF",
    trimName: "soft sunshine yellow",
    description: "Lively blue walls highlighted by sunny yellow trim",
  },
  {
    id: "yellow-brown",
    name: "Sunshine Yellow & Cocoa",
    wall: "#F2C230",
    wallName: "bright sunshine yellow",
    trim: "#70422B",
    trimName: "deep cocoa brown",
    description: "Sunny yellow walls balanced with deep cocoa-brown trim",
  },
];

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5000"
).replace(/\/$/, "");

const PAINT_BRANDS = [
  { id: "berger", name: "Berger Paints" },
  { id: "asian", name: "Asian Paints" },
  { id: "nerolac", name: "Nerolac Paints" },
  { id: "dulux", name: "Dulux Paints" },
];

function hexToLab(hex) {
  const channels = [1, 3, 5].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16)
  );
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [red, green, blue] = linear;
  const x = (red * 0.4124564 + green * 0.3575761 + blue * 0.1804375) / 0.95047;
  const y = red * 0.2126729 + green * 0.7151522 + blue * 0.072175;
  const z = (red * 0.0193339 + green * 0.119192 + blue * 0.9503041) / 1.08883;
  const curve = (value) =>
    value > 0.0088564517 ? value ** (1 / 3) : 7.787037 * value + 16 / 116;
  const fx = curve(x);
  const fy = curve(y);
  const fz = curve(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function getClosestShade(hex, shades) {
  if (!shades.length) return null;
  const detected = hexToLab(hex);
  const closest = shades.reduce((best, shade) => {
    const lab = hexToLab(shade.hex);
    const deltaE = Math.sqrt(
      detected.reduce((sum, value, index) => sum + (value - lab[index]) ** 2, 0)
    );
    return !best || deltaE < best.deltaE
      ? { shade, deltaE }
      : best;
  }, null);
  return {
    ...closest.shade,
    delta_e: Number(closest.deltaE.toFixed(2)),
    similarity: Number(Math.max(0, 100 - closest.deltaE).toFixed(1)),
  };
}

async function createHouseMaskFile(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();

    const maxDimension = 1024;
    const scale = Math.min(
      1,
      maxDimension / Math.max(image.naturalWidth, image.naturalHeight)
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Your browser could not prepare the house segmentation.");
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const houseMask = await detectPaintedHouseMask(canvas);
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    const maskContext = maskCanvas.getContext("2d");
    if (!maskContext) {
      throw new Error("Your browser could not prepare the house segmentation.");
    }
    const maskPixels = maskContext.createImageData(canvas.width, canvas.height);
    for (let index = 0; index < houseMask.length; index += 1) {
      const value = houseMask[index] ? 255 : 0;
      const offset = index * 4;
      maskPixels.data[offset] = value;
      maskPixels.data[offset + 1] = value;
      maskPixels.data[offset + 2] = value;
      maskPixels.data[offset + 3] = 255;
    }
    maskContext.putImageData(maskPixels, 0, 0);

    const blob = await new Promise((resolve, reject) => {
      maskCanvas.toBlob((result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error("Could not encode the house segmentation."));
        }
      }, "image/png");
    });
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function applyGeneratedDesignColours(imageSource, design) {
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () =>
      reject(new Error("The generated preview image could not be opened."));
    image.src = imageSource;
  });

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Your browser could not prepare the generated preview.");
  }

  context.drawImage(image, 0, 0);

  try {
    const masks = await detectExteriorSurfaces(canvas);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const recolouredImage = applyExteriorColours(
      {
        width: canvas.width,
        height: canvas.height,
        pixels: imageData.data,
      },
      masks,
      {
        walls: design.wall,
        borders: design.trim,
        windows: design.trim,
        doors: design.trim,
        gates: design.trim,
      },
      0.85
    );

    context.putImageData(recolouredImage, 0, 0);
    return canvas.toDataURL("image/png");
  } catch (error) {
    if (error instanceof Error && error.message.includes("No paintable")) {
      throw new Error(
        "The house surfaces could not be detected, so the paint colours could not be applied. Try a clearer house photo."
      );
    }
    throw error;
  }
}

export default function PaintingDesign() {
  const [houseCondition, setHouseCondition] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [selectedBrand, setSelectedBrand] = useState("");
  const [shadeCatalogue, setShadeCatalogue] = useState(null);
  const [catalogueError, setCatalogueError] = useState("");
  const [paletteTarget, setPaletteTarget] = useState("walls");
  const [wallColour, setWallColour] = useState(DESIGNS[0].wall);
  const [accentColour, setAccentColour] = useState(DESIGNS[0].trim);
  const [customDesignPreview, setCustomDesignPreview] = useState("");
  const [applyingSelectedColours, setApplyingSelectedColours] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [aiPreviews, setAiPreviews] = useState({});
  const [selectedDesign, setSelectedDesign] = useState("rose-pink");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const analysisRequest = useRef(null);
  const analysisRequestId = useRef(0);

  useEffect(() => {
    if (!photoPreview) return undefined;
    return () => URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  useEffect(
    () => () => {
      analysisRequest.current?.abort();
    },
    []
  );

  useEffect(() => {
    if (!selectedBrand) {
      return undefined;
    }

    const controller = new AbortController();
    fetch(`${API_BASE}/api/paint-shades/${selectedBrand}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Could not load the shade catalogue.");
        }
        return result;
      })
      .then((result) => {
        if (!controller.signal.aborted) setShadeCatalogue(result);
      })
      .catch((err) => {
        if (!controller.signal.aborted && err.name !== "AbortError") {
          setCatalogueError(
            err.message || "Could not load the shade catalogue."
          );
        }
      });
    return () => controller.abort();
  }, [selectedBrand]);

  async function analyzePaintedImage(file, brand) {
    analysisRequest.current?.abort();
    const controller = new AbortController();
    analysisRequest.current = controller;
    const requestId = ++analysisRequestId.current;

    setAnalysisResult(null);
    setAnalysisLoading(true);
    setAnalysisError("");

    const formData = new FormData();
    formData.append("image", file);
    formData.append("brand", brand);

    try {
      const houseMask = await createHouseMaskFile(file);
      if (requestId !== analysisRequestId.current) return;
      formData.append("house_mask", houseMask, "house-mask.png");

      const response = await fetch(`${API_BASE}/api/paint-colour-analysis`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error("The colour analysis service returned an invalid response.");
      }

      if (!response.ok) {
        throw new Error(result.error || "Could not analyse this house image.");
      }
      if (result.analysis_version !== 2) {
        throw new Error(
          "The colour analysis service is outdated. Restart Flask and upload the photo again."
        );
      }
      if (!Array.isArray(result.regions)) {
        throw new Error("The colour analysis response is missing region data.");
      }

      result.regions = result.regions.map((region) => ({
        ...region,
        brand_match: null,
      }));
      result.selected_brand = brand;
      if (requestId === analysisRequestId.current) {
        setAnalysisResult(result);
      }
    } catch (err) {
      if (err.name !== "AbortError" && requestId === analysisRequestId.current) {
        setAnalysisError(
          err.message || "Could not analyse this image. Please try another photo."
        );
      }
    } finally {
      if (requestId === analysisRequestId.current) {
        setAnalysisLoading(false);
        analysisRequest.current = null;
      }
    }
  }

  function handleUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (!houseCondition) {
      setError("Please choose Painted or Not Painted before uploading a photo.");
      return;
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Please upload a JPG, PNG, or WebP image.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError("Please choose an image smaller than 10 MB.");
      return;
    }

    analysisRequest.current?.abort();
    analysisRequest.current = null;
    analysisRequestId.current += 1;
    setAnalysisLoading(false);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    setAiPreviews({});
    setAnalysisResult(null);
    setAnalysisError("");
    setCustomDesignPreview("");
    setError("");
    setProgress("");
  }

  function selectHouseCondition(condition) {
    analysisRequest.current?.abort();
    analysisRequest.current = null;
    analysisRequestId.current += 1;
    setHouseCondition(condition);
    setSelectedBrand("");
    setAiPreviews({});
    setAnalysisResult(null);
    setAnalysisLoading(false);
    setAnalysisError("");
    setCustomDesignPreview("");
    setCatalogueError("");
    setWallColour(DESIGNS[0].wall);
    setAccentColour(DESIGNS[0].trim);
    setError("");
    setProgress("");
  }

  function handleBrandChange(brand) {
    analysisRequest.current?.abort();
    analysisRequest.current = null;
    analysisRequestId.current += 1;
    setAnalysisLoading(false);
    setSelectedBrand(brand);
    setCustomDesignPreview("");
    setAiPreviews({});
    setProgress("");
    setError("");
    setCatalogueError("");
    if (houseCondition !== "painted") {
      setAnalysisResult(null);
      setAnalysisError("");
    }
  }

  function detectPaintColours() {
    if (!photoFile) {
      setAnalysisError("Upload a house image before detecting colours.");
      return;
    }
    if (!selectedBrand) {
      setAnalysisError("Choose a paint brand before detecting colours.");
      return;
    }
    analyzePaintedImage(photoFile, selectedBrand);
  }

  async function applySelectedColours() {
    if (!photoPreview || !selectedBrand) {
      setError("Upload a house photo and choose a paint brand first.");
      return;
    }

    setApplyingSelectedColours(true);
    setError("");
    setCustomDesignPreview("");
    try {
      const image = new Image();
      image.src = photoPreview;
      await image.decode();
      const scale = Math.min(
        1,
        1024 / Math.max(image.naturalWidth, image.naturalHeight)
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        throw new Error("Your browser could not prepare the design preview.");
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const masks = await detectExteriorSurfaces(canvas);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const output = applyExteriorColours(
        {
          width: canvas.width,
          height: canvas.height,
          pixels: imageData.data,
        },
        masks,
        {
          walls: wallColour,
          borders: accentColour,
          windows: accentColour,
          doors: accentColour,
          gates: accentColour,
        },
        0.85
      );
      context.putImageData(output, 0, 0);
      setCustomDesignPreview(canvas.toDataURL("image/png"));
    } catch (err) {
      setError(
        err.message || "Could not apply those colours to the house photo."
      );
    } finally {
      setApplyingSelectedColours(false);
    }
  }

  async function generateAiDesigns() {
    if (!photoFile) {
      setError("Please upload your house photo first.");
      return;
    }
    if (!selectedBrand) {
      setError("Choose a paint brand before generating house designs.");
      return;
    }

    setLoading(true);
    setError("");
    setProgress("Preparing your AI designs...");

    const generated = {};

    try {
      for (let index = 0; index < DESIGNS.length; index++) {
        const design = DESIGNS[index];

        setProgress(
          `Generating design ${index + 1} of ${DESIGNS.length}: ${design.name}`
        );

        const formData = new FormData();
        formData.append("image", photoFile);
        formData.append("wall_color", design.wall);
        formData.append("wall_color_name", design.wallName);
        formData.append("trim_color", design.trim);
        formData.append("trim_color_name", design.trimName);

        const response = await fetch(
          `${API_BASE}/api/home-design/preview`,
          {
            method: "POST",
            body: formData,
          }
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.error || `Failed to generate ${design.name}.`
          );
        }

        if (!result.image) {
          throw new Error(`No image returned for ${design.name}.`);
        }

        setProgress(`Applying ${design.name} to the detected house surfaces...`);
        generated[design.id] = await applyGeneratedDesignColours(
          result.image,
          design
        );
        setAiPreviews({ ...generated });
      }

      setProgress("All five AI designs are ready!");
    } catch (err) {
      setError(
        err.message ||
          "Could not generate designs. Check Flask and your image AI settings."
      );
    } finally {
      setLoading(false);
    }
  }

  function downloadSelectedDesign() {
    const design = DESIGNS.find(
      (item) => item.id === selectedDesign
    );

    const image = aiPreviews[selectedDesign];

    if (!image) {
      setError("Generate the AI designs before downloading.");
      return;
    }

    const link = document.createElement("a");
    link.href = image;
    link.download = `paintwise-${design.id}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  const activeDesign =
    DESIGNS.find((item) => item.id === selectedDesign) || DESIGNS[0];
  const activeShadeCatalogue =
    shadeCatalogue?.brand === selectedBrand ? shadeCatalogue : null;
  const catalogueLoading = Boolean(
    selectedBrand && !activeShadeCatalogue && !catalogueError
  );
  const analysisRegions =
    analysisResult?.regions.map((region) => ({
      ...region,
      brand_match:
        region.detected && activeShadeCatalogue?.available
          ? getClosestShade(region.hex, activeShadeCatalogue.shades)
          : null,
    })) || [];

  return (
    <section className="painting-design-page">
      <div className="design-heading">
        <div>
          <span className="design-eyebrow">
            PAINTWISE DESIGN STUDIO
          </span>
          <h1>AI Painting Design</h1>
          <p>
            Choose your house condition, then detect existing paint colours or
            design a new colour scheme.
          </p>
        </div>
      </div>

      <div
        className={`design-workspace ${
          photoFile && houseCondition === "unpainted"
            ? ""
            : "design-workspace-single-panel"
        }`}
      >
        <div className="design-photo-panel">
          <div className="panel-heading">
            <div>
              <h2>Is this house already painted?</h2>
              <p>Choose one option to continue.</p>
            </div>
          </div>

          <div className="house-condition-options" aria-label="House condition">
            <button
              type="button"
              className={`house-condition-option ${
                houseCondition === "painted" ? "selected" : ""
              }`}
              aria-pressed={houseCondition === "painted"}
              disabled={loading}
              onClick={() => selectHouseCondition("painted")}
            >
              <strong>Painted</strong>
              <span>The house already has paint.</span>
            </button>
            <button
              type="button"
              className={`house-condition-option ${
                houseCondition === "unpainted" ? "selected" : ""
              }`}
              aria-pressed={houseCondition === "unpainted"}
              disabled={loading}
              onClick={() => selectHouseCondition("unpainted")}
            >
              <strong>Not Painted</strong>
              <span>The house needs a paint design.</span>
            </button>
          </div>

          {!photoFile && (
            <label
              className="photo-upload-area"
              onClick={(event) => {
                if (!houseCondition) {
                  event.preventDefault();
                  setError(
                  "Please choose Painted or Not Painted before uploading a photo."
                  );
                }
              }}
            >
              <span className="upload-icon">↑</span>
              <strong>
                {houseCondition
                  ? "Upload your house photo"
                  : "Choose a house condition to upload"}
              </strong>
              <span>JPG, PNG or WebP · Maximum 10 MB</span>

              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleUpload}
                disabled={!houseCondition}
              />
            </label>
          )}

          {photoPreview && (
            <div>
              <img
                src={customDesignPreview || photoPreview}
                alt="Uploaded house or recoloured design preview"
                className="uploaded-house-photo"
                key={customDesignPreview || photoPreview}
                style={{
                  display: "block",
                  width: "100%",
                  maxHeight: 420,
                  objectFit: "contain",
                  borderRadius: 12,
                  marginTop: 16,
                }}
              />

              <p className="photo-filename">
                {photoFile.name}
              </p>

              {houseCondition && (
                <section className="paint-brand-selection">
                  <label htmlFor="paint-brand">
                    Choose a paint brand
                    <select
                      id="paint-brand"
                      value={selectedBrand}
                      onChange={(event) => handleBrandChange(event.target.value)}
                    >
                      <option value="">Select a brand</option>
                      {PAINT_BRANDS.map((brand) => (
                        <option key={brand.id} value={brand.id}>
                          {brand.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {catalogueLoading && (
                    <p className="design-notice" role="status">
                      Loading {PAINT_BRANDS.find((brand) => brand.id === selectedBrand)?.name} shades…
                    </p>
                  )}
                  {catalogueError && (
                    <p className="design-error" role="alert">
                      {catalogueError}
                    </p>
                  )}
                </section>
              )}

              {houseCondition === "painted" && (
                <section className="paint-analysis" aria-live="polite">
                  <div className="paint-analysis-heading">
                    <div>
                      <h3>Existing paint colour detection</h3>
                      <p>
                        Detect significant house colours and find the closest
                        shades in the selected brand palette.
                      </p>
                    </div>
                    {analysisLoading && (
                      <span className="analysis-loading-label" role="status">
                        <span className="analysis-spinner" aria-hidden="true" />
                        Analysing image…
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    className="download-design-button"
                    onClick={detectPaintColours}
                    disabled={!photoFile || !selectedBrand || analysisLoading}
                  >
                    {analysisLoading ? "Detecting colours…" : "Detect Colours"}
                  </button>
                  {(!selectedBrand || !photoFile) && (
                    <p className="paint-analysis-note">
                      Upload a house photo and select a paint brand to enable
                      colour detection.
                    </p>
                  )}

                  {analysisError && (
                    <p className="design-error" role="alert">
                      {analysisError}
                    </p>
                  )}

                  {analysisResult && (
                    <>
                      {analysisRegions.length > 0 ? (
                        <div className="paint-colour-grid">
                          {analysisRegions.map((region) => (
                            <article className="paint-colour-card" key={region.hex}>
                              <span
                                className={`paint-colour-swatch ${
                                  region.detected ? "" : "paint-colour-swatch-empty"
                                }`}
                                style={
                                  region.detected
                                    ? { backgroundColor: region.hex }
                                    : undefined
                                }
                                aria-label={
                                  region.detected
                                    ? `${region.colour_name} swatch`
                                    : "No colour confidently detected"
                                }
                              />
                              <div className="paint-colour-details">
                                <h4>{region.name}</h4>
                                {region.detected ? (
                                  <>
                                    <strong>{region.colour_name}</strong>
                                    <p className="paint-colour-hex">{region.hex}</p>
                                    <p>
                                      Detection confidence:{" "}
                                      {Math.round(region.confidence * 100)}%
                                    </p>
                                  </>
                                ) : (
                                  <p>No colour confidently detected.</p>
                                )}
                                <div className="berger-match">
                                  <span>
                                    Closest{" "}
                                    {PAINT_BRANDS.find(
                                      (brand) => brand.id === selectedBrand
                                    )?.name}{" "}
                                    shade
                                  </span>
                                  {region.brand_match ? (
                                    <>
                                      <strong>{region.brand_match.name}</strong>
                                      <p>
                                        Shade {region.brand_match.code} ·{" "}
                                        {region.brand_match.hex}
                                      </p>
                                      <p>
                                        Similarity: {region.brand_match.similarity}%{" "}
                                        (ΔE {region.brand_match.delta_e})
                                      </p>
                                    </>
                                  ) : (
                                    <p>
                                      {activeShadeCatalogue?.available
                                        ? "No match available for this colour."
                                        : activeShadeCatalogue?.message ||
                                          "No verified shade catalogue is available for this brand."}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="design-error" role="status">
                          No painted house colours were found. Try a clearer photo
                          showing the house front.
                        </p>
                      )}
                      <p className="paint-analysis-note">
                        Closest shade matches are estimates, not a guarantee of
                        the original paint colour. {analysisResult.analysis_note}
                      </p>
                    </>
                  )}
                </section>
              )}

              {houseCondition === "unpainted" && (
                <section className="paint-analysis new-colour-workflow">
                  <div className="paint-analysis-heading">
                    <div>
                      <h3>Design new house colours</h3>
                      <p>
                        Select shades for walls and accents, then preview them
                        on your house.
                      </p>
                    </div>
                  </div>

                  {!selectedBrand ? (
                    <p className="paint-analysis-note">
                      Choose a paint brand to view its available shade palette.
                    </p>
                  ) : catalogueLoading ? (
                    <p className="design-notice" role="status">
                      Loading shade palette…
                    </p>
                  ) : activeShadeCatalogue?.available ? (
                    <>
                      <div className="palette-target-options" role="group" aria-label="Choose which surface to colour">
                        <button
                          type="button"
                          className={paletteTarget === "walls" ? "selected" : ""}
                          aria-pressed={paletteTarget === "walls"}
                          onClick={() => setPaletteTarget("walls")}
                        >
                          Walls
                        </button>
                        <button
                          type="button"
                          className={paletteTarget === "accent" ? "selected" : ""}
                          aria-pressed={paletteTarget === "accent"}
                          onClick={() => setPaletteTarget("accent")}
                        >
                          Accent areas
                        </button>
                      </div>
                      <div className="brand-shade-grid">
                        {activeShadeCatalogue.shades.map((shade) => (
                          <button
                            className="brand-shade-option"
                            key={shade.code}
                            type="button"
                            onClick={() => {
                              if (paletteTarget === "walls") {
                                setWallColour(shade.hex);
                              } else {
                                setAccentColour(shade.hex);
                              }
                              setCustomDesignPreview("");
                            }}
                            aria-label={`Use ${shade.name}, ${shade.code}, for ${paletteTarget}`}
                          >
                            <span
                              className="brand-shade-swatch"
                              style={{ backgroundColor: shade.hex }}
                            />
                            <strong>{shade.name}</strong>
                            <small>{shade.code}</small>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="design-notice" role="status">
                      {activeShadeCatalogue?.message ||
                        "No verified shade catalogue is available for this brand. You can still choose custom wall and accent colours below."}
                    </p>
                  )}

                  <div className="custom-colour-controls">
                    <div className="chosen-colour-swatches" aria-live="polite">
                      <span>
                        <i style={{ backgroundColor: wallColour }} />
                        Wall {wallColour.toUpperCase()}
                      </span>
                      <span>
                        <i style={{ backgroundColor: accentColour }} />
                        Accent {accentColour.toUpperCase()}
                      </span>
                    </div>
                    <label>
                      Wall colour
                      <input
                        type="color"
                        value={wallColour}
                        onChange={(event) => {
                          setWallColour(event.target.value);
                          setCustomDesignPreview("");
                        }}
                      />
                    </label>
                    <label>
                      Accent colour
                      <input
                        type="color"
                        value={accentColour}
                        onChange={(event) => {
                          setAccentColour(event.target.value);
                          setCustomDesignPreview("");
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="download-design-button"
                      onClick={applySelectedColours}
                      disabled={!selectedBrand || applyingSelectedColours}
                    >
                      {applyingSelectedColours
                        ? "Applying colours…"
                        : "Apply selected colours"}
                    </button>
                  </div>
                </section>
              )}

              <div className="photo-actions">
                <label className="secondary-button replace-photo-button">
                  {houseCondition === "painted"
                    ? "Upload another photo"
                    : "Replace photo"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleUpload}
                  />
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    analysisRequest.current?.abort();
                    analysisRequest.current = null;
                    analysisRequestId.current += 1;
                    setPhotoFile(null);
                    setPhotoPreview("");
                    setAnalysisResult(null);
                    setAnalysisLoading(false);
                    setAnalysisError("");
                    setAiPreviews({});
                    setError("");
                    setProgress("");
                  }}
                >
                  Remove photo
                </button>
                {houseCondition === "unpainted" && (
                  <button
                    type="button"
                    className="download-design-button generate-design-button"
                    onClick={generateAiDesigns}
                    disabled={!photoFile || !selectedBrand || loading}
                  >
                    {loading ? "Generating AI designs..." : "Generate 5 AI designs"}
                  </button>
                )}
              </div>
            </div>
          )}

          {progress && (
            <p className="design-notice" role="status">
              {progress}
            </p>
          )}

          {error && (
            <p className="design-error" role="alert">
              {error}
            </p>
          )}

          <p className="privacy-note">
            Painted-house colour analysis runs through your Flask backend.
            Unpainted design previews are sent to the configured image-generation
            service.
          </p>
        </div>

        {photoFile && houseCondition === "unpainted" && (
          <div className="design-results-panel">
            <div className="featured-design-preview">
              {aiPreviews[selectedDesign] ? (
                <img
                  src={aiPreviews[selectedDesign]}
                  alt={`${activeDesign.name} large house painting preview`}
                />
              ) : (
                <div className="preview-placeholder">
                  {loading
                    ? "Generating preview..."
                    : "Generate the designs to see a large preview"}
                </div>
              )}
              <span>{activeDesign.name}</span>
            </div>

            <div className="design-preview-grid">
              {DESIGNS.map((design, index) => (
                <article
                  key={design.id}
                  className={`design-card ${
                    selectedDesign === design.id ? "selected" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="design-card-image-button"
                    onClick={() => setSelectedDesign(design.id)}
                    aria-label={`Select ${design.name}`}
                  >
                    {aiPreviews[design.id] ? (
                      <img
                        src={aiPreviews[design.id]}
                        alt={`${design.name} house painting preview`}
                        className="design-preview-image"
                      />
                    ) : (
                      <div className="preview-placeholder">
                        {loading
                          ? "Generating preview..."
                          : "Generate designs"}
                      </div>
                    )}

                    <span className="design-number">
                      Design {index + 1}
                    </span>
                  </button>

                  <div className="design-card-content">
                    <h3>{design.name}</h3>
                    <div className="design-swatches">
                      <span
                        style={{ backgroundColor: design.wall }}
                        title="Wall colour"
                      />
                      <span
                        style={{ backgroundColor: design.trim }}
                        title="Trim colour"
                      />
                    </div>
                    <button
                      type="button"
                      className={
                        selectedDesign === design.id
                          ? "select-design-button selected-button"
                          : "select-design-button"
                      }
                      onClick={() => setSelectedDesign(design.id)}
                    >
                      {selectedDesign === design.id
                        ? "✓ Selected"
                        : "Select design"}
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <div className="active-design-panel">
              <div>
                <span className="design-eyebrow">
                  CURRENT SELECTION
                </span>
                <h3>{activeDesign.name}</h3>
                <p>{activeDesign.description}</p>
              </div>

              <div className="active-design-colours">
                <span
                  style={{ backgroundColor: activeDesign.wall }}
                  title="Wall colour"
                />
                <span
                  style={{ backgroundColor: activeDesign.trim }}
                  title="Trim colour"
                />
              </div>

              <button
                type="button"
                className="download-design-button"
                onClick={downloadSelectedDesign}
                disabled={!aiPreviews[selectedDesign]}
              >
                Download selected design
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="design-disclaimer">
        AI-generated previews may change small architectural details or
        recolour some areas imperfectly. Review the result before using
        it as a final painting plan.
      </p>
    </section>
  );
}
