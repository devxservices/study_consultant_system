#!/bin/sh
# Backs up the database and every uploaded file, keeping 14 days.
# Run it from cron once a day:
#   15 2 * * *  /opt/crm/deploy/backup.sh >> /var/log/crm-backup.log 2>&1
# Copy deploy/backups somewhere else too (another server, S3, B2): a backup
# on the same disk does not survive the disk.
set -eu
cd "$(dirname "$0")"

STAMP=$(date +%Y-%m-%d_%H%M)
DEST=${BACKUP_DIR:-./backups}
KEEP_DAYS=${KEEP_DAYS:-14}
mkdir -p "$DEST"

# The database, in PostgreSQL's own compressed format.
docker compose exec -T db pg_dump -U crm -Fc crm > "$DEST/db_$STAMP.dump"

# Uploaded files (already encrypted on disk), from the "files" volume.
docker compose run --rm -T --no-deps --user root \
  -v "$(cd "$DEST" && pwd):/backup" --entrypoint tar api \
  czf "/backup/files_$STAMP.tgz" -C /app storage

find "$DEST" -name 'db_*.dump' -mtime +"$KEEP_DAYS" -delete
find "$DEST" -name 'files_*.tgz' -mtime +"$KEEP_DAYS" -delete
echo "backup $STAMP done: $(du -sh "$DEST" | cut -f1) in $DEST"
