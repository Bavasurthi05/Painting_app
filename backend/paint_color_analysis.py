import colorsys
import json
import math
from io import BytesIO
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageOps


MAX_IMAGE_PIXELS = 25_000_000
MAX_IMAGE_DIMENSION = 256
BERGER_DATASET_PATH = Path(__file__).resolve().parent / "data" / "berger_shades.json"
SUPPORTED_FORMATS = {"JPEG", "PNG", "WEBP"}


class BergerDatasetError(RuntimeError):
    pass


def _colour_name(rgb: tuple[int, int, int]) -> str:
    red, green, blue = (channel / 255 for channel in rgb)
    hue, saturation, value = colorsys.rgb_to_hsv(red, green, blue)

    if saturation < 0.17:
        if value >= 0.88:
            return "white"
        if value >= 0.68 and 0.04 <= hue <= 0.18:
            return "cream"
        return "light gray" if value >= 0.65 else "gray"
    if saturation < 0.3 and value > 0.7 and 0.04 <= hue <= 0.2:
        return "cream"
    if hue < 0.025 or hue >= 0.96:
        return "red"
    if hue < 0.09:
        return "brown" if value < 0.62 else "orange"
    if hue < 0.2:
        return "yellow"
    if hue < 0.42:
        return "green"
    if hue < 0.55:
        return "cyan"
    if hue < 0.72:
        return "blue"
    if hue < 0.81:
        return "purple"
    if hue < 0.91:
        return "magenta"
    if hue < 0.96:
        return "pink"
    return "red"


def _rgb_to_lab(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    def linearize(channel: int) -> float:
        value = channel / 255
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    red, green, blue = (linearize(channel) for channel in rgb)
    x = (red * 0.4124564 + green * 0.3575761 + blue * 0.1804375) / 0.95047
    y = red * 0.2126729 + green * 0.7151522 + blue * 0.0721750
    z = (red * 0.0193339 + green * 0.1191920 + blue * 0.9503041) / 1.08883

    def lab_curve(value: float) -> float:
        return value ** (1 / 3) if value > 0.0088564517 else 7.787037 * value + 16 / 116

    fx, fy, fz = lab_curve(x), lab_curve(y), lab_curve(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def _load_berger_shades(dataset_path: Path | None) -> list[dict[str, str]]:
    if dataset_path is None or not dataset_path.is_file():
        return []

    try:
        with dataset_path.open("r", encoding="utf-8") as dataset_file:
            shades = json.load(dataset_file)
    except (OSError, json.JSONDecodeError) as error:
        raise BergerDatasetError("Berger shade dataset could not be read.") from error
    if not isinstance(shades, list):
        raise BergerDatasetError("Berger shade dataset must be a JSON list.")

    validated: list[dict[str, str]] = []
    for shade in shades:
        if not isinstance(shade, dict):
            raise BergerDatasetError("Each Berger shade entry must be an object.")
        name, code, colour = shade.get("name"), shade.get("code"), shade.get("hex")
        if (
            not isinstance(name, str)
            or not name.strip()
            or not isinstance(code, str)
            or not code.strip()
            or not isinstance(colour, str)
            or len(colour) != 7
            or colour[0] != "#"
        ):
            raise BergerDatasetError("Each Berger shade must have a name, code, and #RRGGBB value.")
        try:
            int(colour[1:], 16)
        except ValueError as error:
            raise BergerDatasetError("Berger shade HEX values must use #RRGGBB format.") from error
        validated.append({"name": name.strip(), "code": code.strip(), "hex": colour.upper()})
    if not validated:
        raise BergerDatasetError("Berger shade dataset must contain at least one shade.")
    return validated


def get_paint_shade_catalogue(
    brand: str,
    dataset_path: Path | None = BERGER_DATASET_PATH,
) -> dict[str, Any]:
    if brand != "berger":
        return {
            "brand": brand,
            "available": False,
            "shades": [],
            "message": f"No verified {brand.title()} shade catalogue is configured.",
        }
    shades = _load_berger_shades(dataset_path)
    return {
        "brand": brand,
        "available": bool(shades),
        "shades": shades,
        "message": (
            None
            if shades
            else "No verified Berger Paints shade catalogue is configured."
        ),
    }


def _berger_match(rgb: tuple[int, int, int], shades: list[dict[str, str]]) -> dict[str, Any] | None:
    if not shades:
        return None

    detected_lab = _rgb_to_lab(rgb)
    closest: dict[str, Any] | None = None
    for shade in shades:
        shade_rgb = tuple(int(shade["hex"][index : index + 2], 16) for index in (1, 3, 5))
        shade_lab = _rgb_to_lab(shade_rgb)
        delta_e = math.sqrt(sum((left - right) ** 2 for left, right in zip(detected_lab, shade_lab)))
        if closest is None or delta_e < closest["delta_e"]:
            closest = {
                "name": shade["name"],
                "code": shade["code"],
                "hex": shade["hex"],
                "delta_e": round(delta_e, 2),
                "similarity": round(max(0.0, 100.0 - delta_e), 1),
            }
    return closest


def _delta_e(left: tuple[int, int, int], right: tuple[int, int, int]) -> float:
    left_lab = _rgb_to_lab(left)
    right_lab = _rgb_to_lab(right)
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(left_lab, right_lab)))


def _painted_colour_groups(
    image: Image.Image,
    house_mask: np.ndarray,
) -> list[dict[str, Any]]:
    rgb = np.asarray(image, dtype=np.uint8)
    height, width = rgb.shape[:2]
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)

    saturation = hsv[:, :, 1]
    brightness = hsv[:, :, 2]
    in_house_area = house_mask > 127

    chromatic_paint = (
        (saturation >= 32)
        & (brightness >= 45)
        & (brightness <= 255)
    )
    neutral_paint = (
        (saturation < 32)
        & (brightness >= 105)
    )
    candidate_mask = in_house_area & (chromatic_paint | neutral_paint)
    pixel_positions = np.flatnonzero(candidate_mask)
    if pixel_positions.size < 20:
        return []

    lab_pixels = lab.reshape(-1, 3)[pixel_positions].astype(np.float32)
    rgb_pixels = rgb.reshape(-1, 3)[pixel_positions].astype(np.float32)
    cluster_count = min(
        24,
        max(1, int(math.sqrt(pixel_positions.size) / 4)),
    )
    cv2.setRNGSeed(7)
    _, labels, _ = cv2.kmeans(
        lab_pixels,
        cluster_count,
        None,
        (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_MAX_ITER, 40, 0.4),
        3,
        cv2.KMEANS_PP_CENTERS,
    )
    labels = labels.ravel()

    merged: list[dict[str, Any]] = []
    for cluster_index in range(cluster_count):
        members = labels == cluster_index
        count = int(np.count_nonzero(members))
        if count == 0:
            continue
        cluster_rgb = tuple(
            int(round(channel))
            for channel in np.mean(rgb_pixels[members], axis=0)
        )
        existing = next(
            (
                group
                for group in merged
                if _delta_e(group["rgb"], cluster_rgb) < 11
            ),
            None,
        )
        if existing:
            old_count = existing["count"]
            existing["rgb"] = tuple(
                int(
                    round(
                        (
                            existing["rgb"][channel] * old_count
                            + cluster_rgb[channel] * count
                        )
                        / (old_count + count)
                    )
                )
                for channel in range(3)
            )
            existing["count"] += count
        else:
            merged.append({"rgb": cluster_rgb, "count": count})

    minimum_area = max(20, int(in_house_area.sum() * 0.01))
    significant = [group for group in merged if group["count"] >= minimum_area]
    significant.sort(key=lambda group: group["count"], reverse=True)

    results: list[dict[str, Any]] = []
    total_house_pixels = int(in_house_area.sum())
    for index, group in enumerate(significant):
        colour = group["rgb"]
        colour_name = _colour_name(colour)
        component_name = (
            "Dominant painted exterior colour"
            if index == 0
            else "Additional painted exterior colour"
        )
        hex_colour = "#{:02X}{:02X}{:02X}".format(*colour)
        results.append(
            {
                "name": f"{component_name} — {colour_name}",
                "component": component_name,
                "detected": True,
                "colour_name": colour_name,
                "hex": hex_colour,
                "confidence": round(group["count"] / total_house_pixels, 3),
            }
        )
    return results


def analyze_house_image(
    image_bytes: bytes,
    dataset_path: Path | None = BERGER_DATASET_PATH,
    house_mask_bytes: bytes | None = None,
) -> dict[str, Any]:
    with Image.open(BytesIO(image_bytes)) as source:
        if source.format not in SUPPORTED_FORMATS:
            raise ValueError("Upload a JPEG, PNG, or WebP house image.")
        if source.width * source.height > MAX_IMAGE_PIXELS:
            raise ValueError("Image dimensions are too large to analyse.")
        image = ImageOps.exif_transpose(source).convert("RGB")
        oriented_size = image.size
        image.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)

    if not house_mask_bytes:
        raise ValueError("House segmentation is required to identify painted surfaces.")
    with Image.open(BytesIO(house_mask_bytes)) as mask_source:
        if mask_source.format != "PNG":
            raise ValueError("House segmentation must be a PNG mask.")
        if mask_source.width * mask_source.height > MAX_IMAGE_PIXELS:
            raise ValueError("House segmentation dimensions are too large.")
        house_mask = ImageOps.exif_transpose(mask_source).convert("L")
        mask_ratio = house_mask.width / house_mask.height
        image_ratio = oriented_size[0] / oriented_size[1]
        if abs(mask_ratio - image_ratio) > image_ratio * 0.015:
            raise ValueError("House segmentation does not match the uploaded photo.")
        house_mask = house_mask.resize(image.size, Image.Resampling.NEAREST)
        house_mask_array = np.asarray(house_mask, dtype=np.uint8)
    if not np.any(house_mask_array > 127):
        raise ValueError("No house region was found in the segmentation mask.")

    shades = _load_berger_shades(dataset_path)
    regions = _painted_colour_groups(image, house_mask_array)
    for region in regions:
        region["berger_match"] = _berger_match(
            tuple(int(region["hex"][index : index + 2], 16) for index in (1, 3, 5)),
            shades,
        )
    return {
        "analysis_version": 2,
        "regions": regions,
        "berger_dataset_available": bool(shades),
        "berger_match_status": "available" if shades else "unavailable",
        "berger_match_message": (
            None
            if shades
            else "No verified Berger Paints shade dataset is configured; shade names and codes are not provided."
        ),
        "analysis_note": (
            "The house area is isolated with semantic image segmentation before colour clustering. "
            "Some windows, shadows, or overlapping objects may still affect the estimates."
        ),
    }
