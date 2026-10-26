"""Text helpers that work for Sinhala as well as English (same rules as frontend/src/songs/text.ts)."""

import unicodedata


def normalize_for_search(text: str) -> str:
    """NFC, without the invisible zero-width (non-)joiners some Sinhala keyboards add, lower case."""
    return unicodedata.normalize("NFC", text).replace("‌", "").replace("‍", "").strip().lower()
