#!/usr/bin/env bash
# Rotate team/status.log + team/logs/*.log when they get too large.
# Run manually or via cron. Safe to run even when workers are writing.

set -e
cd "$(dirname "$0")/.."

MAX_SIZE_KB=1024  # 1 MB threshold
ARCHIVE_DIR="team/logs/archive"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$ARCHIVE_DIR"

rotate_if_large() {
  local file="$1"
  if [ ! -f "$file" ]; then return; fi
  local size_kb=$(du -k "$file" | awk '{print $1}')
  if [ "$size_kb" -gt "$MAX_SIZE_KB" ]; then
    local base=$(basename "$file" .log)
    local archive_file="$ARCHIVE_DIR/${base}-${TIMESTAMP}.log"
    cp "$file" "$archive_file"
    : > "$file"  # truncate in place (preserves the file handle for appenders)
    echo "rotated $file → $archive_file (${size_kb} KB)"
  fi
}

rotate_if_large "team/status.log"
for f in team/logs/*.log; do
  rotate_if_large "$f"
done

# Compress archives older than 1 day
find "$ARCHIVE_DIR" -name "*.log" -mtime +1 -exec gzip {} \; 2>/dev/null || true

# Delete compressed archives older than 30 days
find "$ARCHIVE_DIR" -name "*.log.gz" -mtime +30 -delete 2>/dev/null || true

echo "log rotation complete"
