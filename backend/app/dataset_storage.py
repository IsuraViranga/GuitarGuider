"""Where the dataset collector keeps its audio files (never in the database).

- "s3": a private S3-compatible bucket (Backblaze B2 on the website). The keys stay on the server;
  the admin plays a file through a signed link that works for a few minutes only.
- "local": a folder on this computer, for development. The API sends the file to the admin.
- Not set: storage is off and nothing can be saved, so a sample is never half-saved.
Tests replace get_store with a store in memory.
"""

import re
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from .config import get_settings

# Keys are made by the server only (app/dataset.py): never from anything the browser sent.
KEY_PATTERN = re.compile(r"^samples/[0-9a-f]{32}\.wav$")
SIGNED_LINK_SECONDS = 300


class StorageError(Exception):
    """The storage did not do what was asked (unreachable, refused, ...)."""


class AudioStore(Protocol):
    name: str

    def put(self, key: str, data: bytes, content_type: str) -> None: ...
    def get(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...
    def playback_url(self, key: str, sample_id: str) -> str: ...


def _checked(key: str) -> str:
    if not KEY_PATTERN.match(key):
        raise StorageError(f"Not a dataset audio key: {key!r}")
    return key


class S3Store:
    def __init__(self, endpoint: str, region: str, bucket: str, key_id: str, secret: str) -> None:
        import boto3  # only loaded when this storage is used
        from botocore.config import Config

        self.name = f"s3:{bucket}"
        self._bucket = bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            region_name=region,
            aws_access_key_id=key_id,
            aws_secret_access_key=secret,
            # Plain requests that every S3-compatible service accepts.
            config=Config(signature_version="s3v4", request_checksum_calculation="when_required", response_checksum_validation="when_required", retries={"max_attempts": 3}),
        )

    def put(self, key: str, data: bytes, content_type: str) -> None:
        try:
            self._client.put_object(Bucket=self._bucket, Key=_checked(key), Body=data, ContentType=content_type)
        except Exception as error:  # noqa: BLE001 - any failure means "not stored"
            raise StorageError(str(error)) from error

    def get(self, key: str) -> bytes:
        try:
            return self._client.get_object(Bucket=self._bucket, Key=_checked(key))["Body"].read()
        except Exception as error:  # noqa: BLE001
            raise StorageError(str(error)) from error

    def delete(self, key: str) -> None:
        try:
            self._client.delete_object(Bucket=self._bucket, Key=_checked(key))
        except Exception as error:  # noqa: BLE001
            raise StorageError(str(error)) from error

    def playback_url(self, key: str, sample_id: str) -> str:
        return self._client.generate_presigned_url("get_object", Params={"Bucket": self._bucket, "Key": _checked(key)}, ExpiresIn=SIGNED_LINK_SECONDS)


class LocalStore:
    def __init__(self, folder: str) -> None:
        self.name = "local"
        self._folder = Path(folder).resolve()

    def _path(self, key: str) -> Path:
        return self._folder / _checked(key)

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        except OSError as error:
            raise StorageError(str(error)) from error

    def get(self, key: str) -> bytes:
        try:
            return self._path(key).read_bytes()
        except OSError as error:
            raise StorageError(str(error)) from error

    def delete(self, key: str) -> None:
        try:
            self._path(key).unlink(missing_ok=True)
        except OSError as error:
            raise StorageError(str(error)) from error

    def playback_url(self, key: str, sample_id: str) -> str:
        # Sent by the API itself, to the admin only (app/dataset.py).
        return f"/api/dataset/samples/{sample_id}/audio"


@lru_cache
def get_store() -> AudioStore | None:
    settings = get_settings()
    if settings.dataset_storage == "s3":
        values = (settings.dataset_s3_endpoint, settings.dataset_s3_region, settings.dataset_s3_bucket, settings.dataset_s3_key_id, settings.dataset_s3_secret)
        # Until every value is filled in on the server, storage stays off.
        return S3Store(*values) if all(values) else None
    if settings.dataset_storage == "local":
        return LocalStore(settings.dataset_local_dir)
    return None
