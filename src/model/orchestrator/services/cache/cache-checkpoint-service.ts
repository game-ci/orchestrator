import fs from 'node:fs';
import path from 'node:path';
import { OrchestratorFolders } from '../../options/orchestrator-folders';
import OrchestratorLogger from '../core/orchestrator-logger';
import { OrchestratorSystem } from '../core/orchestrator-system';
import Orchestrator from '../../orchestrator';

/**
 * Periodic cache checkpointing for long-running builds.
 *
 * When enabled via `cacheCheckpointInterval`, this service tars the Library
 * folder at regular intervals during the Unity build. If the build is
 * interrupted (OOM, timeout, crash), the latest checkpoint survives and is
 * uploaded to S3 by the post-build or failure hooks.
 *
 * This solves the cold-start problem for massive projects: even if a 6-hour
 * build times out, the next build starts from the latest checkpoint rather
 * than reimporting everything from scratch.
 */
export class CacheCheckpointService {
  private static intervalHandle: ReturnType<typeof setInterval> | null = null;
  private static checkpointCount = 0;
  private static isCheckpointing = false;

  /**
   * Generate shell commands to run periodic checkpoints inside the build container.
   * These run as a background process alongside the Unity build.
   *
   * @param intervalMinutes - How often to checkpoint (0 = disabled)
   * @param cachePath - Path to cache directory (e.g., /data/cache/$CACHE_KEY)
   */
  static generateCheckpointScript(intervalMinutes: number, cachePath: string): string {
    if (intervalMinutes <= 0) return '';

    const intervalSeconds = intervalMinutes * 60;

    return `
    # --- Cache Checkpoint Background Process ---
    # Periodically saves Library folder state so interrupted builds don't lose all progress.
    (
      CHECKPOINT_INTERVAL=${intervalSeconds}
      CHECKPOINT_COUNT=0
      LIBRARY_PATH="$GITHUB_WORKSPACE/Library"
      CHECKPOINT_DIR="${cachePath}/Library"
      mkdir -p "$CHECKPOINT_DIR"

      while true; do
        sleep $CHECKPOINT_INTERVAL

        # Only checkpoint if Library exists and has content
        if [ -d "$LIBRARY_PATH" ] && [ "$(ls -A "$LIBRARY_PATH" 2>/dev/null)" ]; then
          CHECKPOINT_COUNT=$((CHECKPOINT_COUNT + 1))
          CHECKPOINT_FILE="$CHECKPOINT_DIR/checkpoint-$CHECKPOINT_COUNT.tar"

          # Create checkpoint tar (overwrite previous to save disk space)
          # Keep only latest 2 checkpoints
          if [ $CHECKPOINT_COUNT -gt 2 ]; then
            OLD_CHECKPOINT=$((CHECKPOINT_COUNT - 2))
            rm -f "$CHECKPOINT_DIR/checkpoint-$OLD_CHECKPOINT.tar" 2>/dev/null
            rm -f "$CHECKPOINT_DIR/checkpoint-$OLD_CHECKPOINT.tar.lz4" 2>/dev/null
          fi

          echo "[Cache Checkpoint] Creating checkpoint #$CHECKPOINT_COUNT at $(date -u +%H:%M:%S)..."
          cd "$GITHUB_WORKSPACE"
          if command -v lz4 > /dev/null 2>&1; then
            tar -cf - Library | lz4 > "$CHECKPOINT_FILE.lz4" 2>/dev/null && \\
              echo "[Cache Checkpoint] Checkpoint #$CHECKPOINT_COUNT saved ($(du -sh "$CHECKPOINT_FILE.lz4" 2>/dev/null | cut -f1))" || \\
              echo "[Cache Checkpoint] Checkpoint #$CHECKPOINT_COUNT failed (continuing)"
          else
            tar -cf "$CHECKPOINT_FILE" Library 2>/dev/null && \\
              echo "[Cache Checkpoint] Checkpoint #$CHECKPOINT_COUNT saved ($(du -sh "$CHECKPOINT_FILE" 2>/dev/null | cut -f1))" || \\
              echo "[Cache Checkpoint] Checkpoint #$CHECKPOINT_COUNT failed (continuing)"
          fi
        fi
      done
    ) &
    CHECKPOINT_PID=$!
    echo "[Cache Checkpoint] Started background checkpointing every ${intervalMinutes} min (PID: $CHECKPOINT_PID)"
    `;
  }

  /**
   * Generate shell commands to stop the checkpoint process and finalize.
   * Called before post-build to stop background checkpointing cleanly.
   */
  static generateCheckpointStopScript(): string {
    return `
    # Stop checkpoint background process if running
    if [ -n "$CHECKPOINT_PID" ]; then
      kill $CHECKPOINT_PID 2>/dev/null || true
      wait $CHECKPOINT_PID 2>/dev/null || true
      echo "[Cache Checkpoint] Stopped background checkpointing"
    fi
    `;
  }

  /**
   * Generate a shell trap that saves cache on build failure/signal.
   * This ensures partial cache is preserved even on OOM or timeout.
   */
  static generateFailureTrapScript(cachePath: string): string {
    return `
    # --- Cache Save on Failure Trap ---
    # If the build is killed (OOM, timeout, SIGTERM), attempt to save whatever
    # Library state exists so the next build doesn't start from zero.
    _cache_save_on_failure() {
      local EXIT_CODE=$?
      if [ $EXIT_CODE -ne 0 ] && [ -d "$GITHUB_WORKSPACE/Library" ] && [ "$(ls -A "$GITHUB_WORKSPACE/Library" 2>/dev/null)" ]; then
        echo "[Cache Recovery] Build failed (exit $EXIT_CODE) — saving partial Library cache..."
        RECOVERY_DIR="${cachePath}/Library"
        mkdir -p "$RECOVERY_DIR"
        cd "$GITHUB_WORKSPACE"
        if command -v lz4 > /dev/null 2>&1; then
          tar -cf - Library | lz4 > "$RECOVERY_DIR/recovery-partial.tar.lz4" 2>/dev/null || true
        else
          tar -cf "$RECOVERY_DIR/recovery-partial.tar" Library 2>/dev/null || true
        fi
        echo "[Cache Recovery] Partial cache saved — next build will restore from this checkpoint"
      fi
    }
    trap _cache_save_on_failure EXIT SIGTERM SIGKILL
    `;
  }

  /**
   * Generate shell commands for S3 cache retention cleanup.
   * Removes cache entries older than maxDays from the S3 bucket.
   *
   * @param maxDays - Maximum age in days (0 = no cleanup)
   * @param bucketPath - S3 path prefix to clean
   */
  static generateRetentionCleanupScript(maxDays: number, bucketPath: string): string {
    if (maxDays <= 0) return '';

    return `
    # --- Cache Retention Cleanup ---
    # Remove cache entries older than ${maxDays} days from S3
    if command -v aws > /dev/null 2>&1 && [ -n "$AWS_ACCESS_KEY_ID" ]; then
      echo "[Cache Retention] Cleaning entries older than ${maxDays} days from ${bucketPath}..."
      CUTOFF_DATE=$(date -d "-${maxDays} days" +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -v-${maxDays}d +%Y-%m-%dT%H:%M:%S 2>/dev/null || echo "")
      if [ -n "$CUTOFF_DATE" ]; then
        aws s3 ls "${bucketPath}" --recursive 2>/dev/null | while read -r line; do
          FILE_DATE=$(echo "$line" | awk '{print $1"T"$2}')
          FILE_PATH=$(echo "$line" | awk '{print $4}')
          if [ -n "$FILE_PATH" ] && [[ "$FILE_DATE" < "$CUTOFF_DATE" ]]; then
            aws s3 rm "s3://$(echo "${bucketPath}" | sed 's|s3://||' | cut -d/ -f1)/$FILE_PATH" 2>/dev/null || true
          fi
        done
        echo "[Cache Retention] Cleanup complete"
      fi
    fi
    `;
  }
}
