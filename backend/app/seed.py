"""Built-in songs (the instructor's library and the app's samples) added to the global set list.

app/seed/global_songs.json is made by the frontend (npm run export:songs), so the songs are
converted by exactly the same code the app uses. Each built-in song is added once: if the admin
later changes or deletes it, that choice stays (seed_log remembers what was already added).
"""

import json
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .db import PREPARE_LOCK_ID
from .models import SeedLog, Song
from .song_schemas import SongIn
from .songs import apply

SEED_FILE = Path(__file__).parent / "seed" / "global_songs.json"


def load_seed_songs(path: Path = SEED_FILE) -> list[tuple[str, SongIn]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return [(item["id"], SongIn.model_validate({key: value for key, value in item.items() if key != "id"})) for item in raw]


def seed_global_songs(db: Session, path: Path = SEED_FILE) -> list[str]:
    """Adds built-in songs never added before. Returns the ids added."""
    if db.get_bind().dialect.name == "postgresql":
        # Two servers starting at once: the second waits here, then finds every song already added.
        db.execute(text("select pg_advisory_xact_lock(:id)"), {"id": PREPARE_LOCK_ID})
    done = set(db.scalars(select(SeedLog.song_id)).all())
    added = []
    for song_id, data in load_seed_songs(path):
        if song_id in done:
            continue
        if db.get(Song, song_id) is None:
            song = Song(id=song_id, scope="global", owner_id=None, created_by=None)
            apply(song, data)
            db.add(song)
            added.append(song_id)
        db.add(SeedLog(song_id=song_id))
    db.commit()
    return added
