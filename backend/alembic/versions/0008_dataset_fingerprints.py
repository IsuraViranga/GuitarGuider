"""Dataset collector: each guitar's sound-match fingerprints (worked out in the admin's browser).

Revision ID: 0008_dataset_fingerprints
Revises: 0007_dataset_collector
Create Date: 2026-11-01
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0008_dataset_fingerprints"
down_revision = "0007_dataset_collector"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("dataset_guitars", sa.Column("fingerprints", JSONB()))
    op.add_column("dataset_guitars", sa.Column("fingerprints_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("dataset_guitars", "fingerprints_at")
    op.drop_column("dataset_guitars", "fingerprints")
