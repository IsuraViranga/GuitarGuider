"""Copies the dataset collector's audio from the bucket to this computer, for research.

    python -m app.dataset_download path/to/dataset.jsonl [--to ../datasets/collector-b2]

The labels come from the Samples tab (⬇ JSONL). The bucket's address and keys are read from
backend/.env (DATASET_S3_*, never committed); a read-only key for that bucket is enough. Files
already copied are skipped, so it can be run again after more recording. Rejected samples are left
out. Next to the files it writes labels.jsonl: the labels of every file that is there.
"""

import argparse
import json
import sys
from pathlib import Path

from .config import get_settings
from .dataset_storage import KEY_PATTERN, AudioStore, S3Store, StorageError

DEFAULT_FOLDER = "../datasets/collector-b2"


def download(records: list[dict], store: AudioStore, folder: Path) -> dict[str, int]:
    """Copies the audio of `records` (export rows) into `folder`; returns how many were copied, skipped, failed."""
    counts = {"copied": 0, "skipped": 0, "failed": 0}
    kept = []
    for record in records:
        if record.get("status") == "rejected":
            continue
        key = record.get("audio_key", "")
        if not KEY_PATTERN.match(key):
            print(f"Not a dataset audio key, left out: {key!r}", file=sys.stderr)
            counts["failed"] += 1
            continue
        path = folder / key
        if path.is_file() and path.stat().st_size == record["audio_bytes"]:
            counts["skipped"] += 1
        else:
            try:
                data = store.get(key)
            except StorageError as error:
                print(f"Could not copy {key}: {error}", file=sys.stderr)
                counts["failed"] += 1
                continue
            if not data.startswith(b"RIFF") or len(data) != record["audio_bytes"]:
                print(f"Not the WAV file that was saved, left out: {key}", file=sys.stderr)
                counts["failed"] += 1
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            counts["copied"] += 1
        kept.append(record)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "labels.jsonl").write_text("".join(json.dumps(r) + "\n" for r in kept), encoding="utf-8")
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Copy the dataset collector's audio from the bucket to this computer.")
    parser.add_argument("labels", help="the JSONL file from the Samples tab (its JSONL button)")
    parser.add_argument("--to", default=DEFAULT_FOLDER, help=f"where to put the files (default {DEFAULT_FOLDER})")
    args = parser.parse_args(argv)
    settings = get_settings()
    values = (settings.dataset_s3_endpoint, settings.dataset_s3_region, settings.dataset_s3_bucket, settings.dataset_s3_key_id, settings.dataset_s3_secret)
    if not all(values):
        print("Fill in DATASET_S3_ENDPOINT, _REGION, _BUCKET, _KEY_ID and _SECRET in backend/.env first.", file=sys.stderr)
        return 2
    records = [json.loads(line) for line in Path(args.labels).read_text(encoding="utf-8").splitlines() if line.strip()]
    folder = Path(args.to)
    counts = download(records, S3Store(*values), folder)
    print(f"Copied {counts['copied']}, already here {counts['skipped']}, failed {counts['failed']}: {folder.resolve()}")
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
