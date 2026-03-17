"""CHIRP integration: radio listing, file detection, and memory conversion."""

import logging
import tempfile
from dataclasses import dataclass, field

from chirp import directory, import_logic, memmap

from app.config import UPLOAD_DIR

LOG = logging.getLogger(__name__)

# Populated once at startup by init_drivers()
_radio_cache: dict[str, list[str]] | None = None


def init_drivers():
    """Import all CHIRP drivers.  Call once at app startup."""
    directory.import_drivers()
    global _radio_cache
    _radio_cache = _build_radio_list()
    LOG.info("Loaded %d radio vendors", len(_radio_cache))


def _build_radio_list() -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for drv_id, cls in sorted(directory.DRV_TO_RADIO.items()):
        vendor = cls.VENDOR
        model = cls.MODEL
        if hasattr(cls, "VARIANT"):
            model = f"{model} ({cls.VARIANT})"
        result.setdefault(vendor, []).append(model)
    # Sort models within each vendor
    for vendor in result:
        result[vendor] = sorted(set(result[vendor]))
    return dict(sorted(result.items()))


def get_supported_radios() -> dict[str, list[str]]:
    """Return {vendor: [model, ...]} for all supported radios."""
    if _radio_cache is None:
        init_drivers()
    return _radio_cache


def detect_source_radio(file_path: str) -> tuple[str, str]:
    """Auto-detect radio vendor and model from an image file.

    Returns (vendor, model).
    Raises ValueError if detection fails.
    """
    try:
        radio = directory.get_radio_by_image(file_path)
    except Exception as exc:
        raise ValueError(f"Could not detect radio from file: {exc}") from exc
    model = radio.MODEL
    if hasattr(radio, "VARIANT") and radio.VARIANT:
        model = f"{model} ({radio.VARIANT})"
    return radio.VENDOR, model


def _find_radio_class(vendor: str, model: str):
    """Look up a radio class by vendor + model string."""
    for cls in directory.DRV_TO_RADIO.values():
        cls_model = cls.MODEL
        if hasattr(cls, "VARIANT") and cls.VARIANT:
            cls_model = f"{cls.MODEL} ({cls.VARIANT})"
        if cls.VENDOR == vendor and cls_model == model:
            return cls
    raise ValueError(f"Unknown radio: {vendor} {model}")


@dataclass
class ConversionResult:
    output_path: str = ""
    source_vendor: str = ""
    source_model: str = ""
    dest_vendor: str = ""
    dest_model: str = ""
    converted: int = 0
    skipped: int = 0
    warnings: list[str] = field(default_factory=list)


def convert(
    source_path: str,
    dest_vendor: str,
    dest_model: str,
    source_vendor: str | None = None,
    source_model: str | None = None,
) -> ConversionResult:
    """Convert a source radio image to a destination radio format.

    If source_vendor/source_model are given they override auto-detection.
    Returns a ConversionResult with path to the converted file.
    """
    result = ConversionResult(dest_vendor=dest_vendor, dest_model=dest_model)

    # Load source radio
    if source_vendor and source_model:
        src_cls = _find_radio_class(source_vendor, source_model)
        src_radio = src_cls(source_path)
        src_radio.load_mmap(source_path)
    else:
        src_radio = directory.get_radio_by_image(source_path)

    result.source_vendor = src_radio.VENDOR
    src_model = src_radio.MODEL
    if hasattr(src_radio, "VARIANT") and src_radio.VARIANT:
        src_model = f"{src_radio.MODEL} ({src_radio.VARIANT})"
    result.source_model = src_model

    src_features = src_radio.get_features()
    lo, hi = src_features.memory_bounds

    # Create destination radio with empty memory map
    dst_cls = _find_radio_class(dest_vendor, dest_model)
    if hasattr(dst_cls, '_memsize') and dst_cls._memsize:
        empty_mmap = memmap.MemoryMapBytes(b"\xFF" * dst_cls._memsize)
        dst_radio = dst_cls(empty_mmap)
    else:
        dst_radio = dst_cls(None)

    dst_features = dst_radio.get_features()
    dst_lo, dst_hi = dst_features.memory_bounds

    dst_slot = dst_lo
    for i in range(lo, hi + 1):
        if dst_slot > dst_hi:
            result.warnings.append(
                f"Destination radio full at memory {dst_slot}; "
                f"remaining source memories skipped."
            )
            remaining = hi - i + 1
            result.skipped += remaining
            break

        try:
            src_mem = src_radio.get_memory(i)
        except Exception:
            continue

        if src_mem.empty:
            continue

        try:
            dst_mem = import_logic.import_mem(dst_radio, src_features, src_mem)
            dst_mem.number = dst_slot
            dst_radio.set_memory(dst_mem)
            result.converted += 1
            dst_slot += 1
        except Exception as exc:
            result.skipped += 1
            result.warnings.append(
                f"Ch {i} ({src_mem.name or src_mem.freq}): {exc}"
            )

    # Save to temp file
    suffix = f".{dst_cls.FILE_EXTENSION}" if hasattr(dst_cls, "FILE_EXTENSION") else ".img"
    tmp = tempfile.NamedTemporaryFile(
        delete=False, suffix=suffix, dir=str(UPLOAD_DIR)
    )
    tmp.close()
    dst_radio.save(tmp.name)
    result.output_path = tmp.name

    return result
