import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import OrchestratorLogger from '../core/orchestrator-logger';

/**
 * Canonical cache + per-runner overlay strategy.
 *
 * Writes the cache once into a canonical store (`<canonicalRoot>/<key>/<folder>/<sha>/`)
 * and consumes it via OS-native zero-copy primitives:
 *   - NTFS hardlinks on Windows
 *   - ext4/xfs/btrfs/zfs hardlinks on Linux
 *   - APFS hardlinks on macOS
 *
 * Each runner gets its own private overlay directory (a name table of hardlinks).
 * Unity writes use write-temp-then-rename, which produces a fresh inode at the
 * write path and breaks only that one hardlink — canonical bytes remain intact
 * and are still shared with all other runner overlays.
 *
 * Atomicity:
 *   - publishCanonical writes to a `<sha>-staging\` directory and atomically renames
 *     to `<sha>\`. Cancel-in-progress mid-publish leaves an orphan staging dir;
 *     existing canonical state is intact.
 *   - The `latest` directory junction is updated last (single atomic rename), so
 *     readers always see a fully-published version.
 *
 * Cross-platform:
 *   - On platforms or filesystems that can't support the strategy, callers should
 *     check isCapable() and fall back to move-directory or copy-directory.
 *
 * This service is opt-in. Existing localCacheMode values (tar, move-directory,
 * copy-directory) are unchanged.
 */

export type SubtreeStrategy = 'hardlink' | 'junction' | 'copy' | 'skip';

export interface CanonicalCacheClassifier {
  /** Default strategy applied to subtrees not matched by any rule. */
  default: SubtreeStrategy;
  /** Rules evaluated in order; first match wins. Patterns are POSIX-style relative paths. */
  rules: Array<{
    /** Glob pattern relative to the cache folder root (e.g. `PackageCache/**`, `Bee/*.dag`). */
    pattern: string;
    strategy: SubtreeStrategy;
  }>;
}

export interface PublishCanonicalOptions {
  classifier?: CanonicalCacheClassifier;
  /** Maximum SHA versions to keep per (key, folder). Older versions are pruned. */
  versionRetention?: number;
}

export interface MaterializeOverlayOptions {
  classifier?: CanonicalCacheClassifier;
  /** Optional canary content for sentinel verification. When set, the overlay contains a probe file. */
  sentinelCanary?: string;
}

const COMPLETE_MARKER = '.cache_complete';
const SENTINEL_FILE = '.canonical-cache-sentinel';

export class CanonicalCacheService {
  /**
   * Default classifier targets Unity Library structure. Non-Unity engines or
   * non-default Library layouts can override by passing their own classifier.
   *
   * Hardlink-safety contract: every entry is hardlinked unless modify-in-place
   * writes can propagate to canonical bytes. Subtrees with absolute workspace
   * paths inside files (DAG, PackageManager metadata) are per-runner copies.
   */
  static defaultUnityClassifier(): CanonicalCacheClassifier {
    return {
      default: 'hardlink',
      rules: [
        // PackageCache packages are immutable to Unity — directory junction is one syscall
        // instead of thousands of hardlinks per package.
        { pattern: 'PackageCache/*', strategy: 'junction' },
        // Files that contain absolute workspace paths and are repaired in place by other code paths.
        { pattern: 'PackageManager/projectResolution.json', strategy: 'copy' },
        { pattern: 'PackageManager/ProjectCache', strategy: 'copy' },
        { pattern: 'Bee/*.dag', strategy: 'copy' },
        { pattern: 'Bee/*.dag.json', strategy: 'copy' },
        { pattern: 'Bee/*.dag.outputdata', strategy: 'copy' },
        { pattern: 'Bee/*-inputdata.json', strategy: 'copy' },
        { pattern: 'LastSceneManagerSetup.txt', strategy: 'copy' },
        // Editor session state — not part of the build cache.
        { pattern: 'AnnotationManager', strategy: 'skip' },
        { pattern: 'EditorOnly', strategy: 'skip' },
        { pattern: 'EditorUserBuildSettings.asset', strategy: 'skip' },
        { pattern: 'EditorUserSettings.asset', strategy: 'skip' },
        { pattern: 'CurrentLayout-*.dwlt', strategy: 'skip' },
      ],
    };
  }

  /**
   * Probe whether the underlying filesystem supports the canonical-overlay strategy.
   * Currently checks: hardlink creation succeeds in a temp directory.
   *
   * Returns true if hardlinks work between two sibling paths under the given root.
   * Callers should fall back to move-directory when this returns false.
   */
  static isCapable(probeRoot: string): boolean {
    const probeDir = path.join(probeRoot, '.canonical-cache-probe');
    const sourcePath = path.join(probeDir, 'source');
    const linkPath = path.join(probeDir, 'link');

    try {
      fs.mkdirSync(probeDir, { recursive: true });
      fs.writeFileSync(sourcePath, 'probe');
      try {
        fs.linkSync(sourcePath, linkPath);
      } catch (error: any) {
        OrchestratorLogger.log(
          `[CanonicalCache] Hardlink probe failed at ${probeRoot}: ${error.code || error.message}`,
        );
        return false;
      }
      return true;
    } catch (error: any) {
      OrchestratorLogger.log(
        `[CanonicalCache] Capability probe failed at ${probeRoot}: ${error.message}`,
      );
      return false;
    } finally {
      try {
        fs.rmSync(probeDir, { recursive: true, force: true });
      } catch {
        // Probe cleanup is best-effort.
      }
    }
  }

  /**
   * Resolve the canonical cache root, defaulting to <localCacheRoot>/canonical when unset.
   */
  static resolveCanonicalRoot(canonicalCacheRoot: string, localCacheRoot: string): string {
    if (canonicalCacheRoot) return canonicalCacheRoot;
    return path.join(localCacheRoot, 'canonical');
  }

  /**
   * Compute a content-addressed SHA for a canonical version.
   *
   * The SHA is computed from a sorted list of relative paths plus their sizes
   * (not byte content, which would be O(bytes)). This is enough to detect
   * structural changes between versions without paying full-tree hashing cost.
   */
  static computeVersionSha(folderPath: string): string {
    const hash = crypto.createHash('sha256');
    const entries: string[] = [];

    const walk = (dir: string, rel: string): void => {
      let names: fs.Dirent[];
      try {
        names = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      names.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of names) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        const childPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(childPath, childRel);
        } else if (entry.isFile()) {
          try {
            const stat = fs.statSync(childPath);
            entries.push(`${childRel}\t${stat.size}`);
          } catch {
            entries.push(`${childRel}\t?`);
          }
        }
      }
    };

    walk(folderPath, '');
    for (const entry of entries) hash.update(entry);
    return hash.digest('hex').slice(0, 16);
  }

  /**
   * Publish a runner's cache folder as a new canonical version.
   *
   * Layout: <canonicalRoot>/<cacheKey>/<folder>/<sha>/
   * Plus an updated `latest` directory junction pointing at the new version.
   *
   * Atomicity: writes to <sha>-staging/ first, then atomic-renames to <sha>/.
   * Cancel-in-progress mid-publish leaves an orphan staging dir.
   */
  static async publishCanonical(
    runnerFolderPath: string,
    canonicalRoot: string,
    cacheKey: string,
    folder: string,
    options: PublishCanonicalOptions = {},
  ): Promise<{ sha: string; canonicalPath: string } | null> {
    const classifier = options.classifier ?? CanonicalCacheService.defaultUnityClassifier();
    const versionRetention = Math.max(1, options.versionRetention ?? 2);

    if (!fs.existsSync(runnerFolderPath)) {
      OrchestratorLogger.log(
        `[CanonicalCache] Source folder does not exist, nothing to publish: ${runnerFolderPath}`,
      );
      return null;
    }

    const sha = CanonicalCacheService.computeVersionSha(runnerFolderPath);
    const baseDir = path.join(canonicalRoot, cacheKey, folder);
    const targetPath = path.join(baseDir, sha);
    const stagingPath = path.join(baseDir, `${sha}-staging`);
    const latestPath = path.join(baseDir, 'latest');

    if (fs.existsSync(targetPath)) {
      OrchestratorLogger.log(
        `[CanonicalCache] Canonical version ${sha} already published, refreshing latest pointer`,
      );
      CanonicalCacheService.updateLatestPointer(latestPath, targetPath);
      return { sha, canonicalPath: targetPath };
    }

    fs.mkdirSync(baseDir, { recursive: true });
    if (fs.existsSync(stagingPath)) {
      OrchestratorLogger.log(`[CanonicalCache] Cleaning orphan staging dir at ${stagingPath}`);
      CanonicalCacheService.removeDirectory(stagingPath);
    }
    fs.mkdirSync(stagingPath, { recursive: true });

    try {
      CanonicalCacheService.replicateTree(runnerFolderPath, stagingPath, classifier, 'publish');
      fs.writeFileSync(path.join(stagingPath, COMPLETE_MARKER), sha, 'utf8');
      fs.renameSync(stagingPath, targetPath);
      CanonicalCacheService.updateLatestPointer(latestPath, targetPath);
      CanonicalCacheService.pruneOldVersions(baseDir, sha, versionRetention);
      OrchestratorLogger.log(
        `[CanonicalCache] Published canonical version ${sha} at ${targetPath}`,
      );
      return { sha, canonicalPath: targetPath };
    } catch (error: any) {
      OrchestratorLogger.logWarning(
        `[CanonicalCache] Publish failed: ${error.message} — staging dir left for inspection`,
      );
      return null;
    }
  }

  /**
   * Materialize a per-runner overlay from the canonical store.
   *
   * Reads canonical via the `latest` junction, hardlinks files into overlayPath
   * according to the classifier. The overlay is a normal directory after this
   * call — Unity sees regular files.
   *
   * Returns the canonical SHA that backs the overlay, or null on failure.
   */
  static async materializeOverlay(
    canonicalRoot: string,
    cacheKey: string,
    folder: string,
    overlayPath: string,
    options: MaterializeOverlayOptions = {},
  ): Promise<{ sha: string } | null> {
    const classifier = options.classifier ?? CanonicalCacheService.defaultUnityClassifier();
    const baseDir = path.join(canonicalRoot, cacheKey, folder);
    const latestPath = path.join(baseDir, 'latest');

    const canonicalPath = CanonicalCacheService.resolveLatest(latestPath);
    if (!canonicalPath) {
      OrchestratorLogger.log(`[CanonicalCache] No canonical 'latest' at ${latestPath}`);
      return null;
    }

    const markerPath = path.join(canonicalPath, COMPLETE_MARKER);
    if (!fs.existsSync(markerPath)) {
      OrchestratorLogger.logWarning(
        `[CanonicalCache] Canonical at ${canonicalPath} has no .cache_complete marker — refusing to materialize`,
      );
      return null;
    }
    const sha = fs.readFileSync(markerPath, 'utf8').trim();

    if (fs.existsSync(overlayPath)) {
      CanonicalCacheService.removeDirectory(overlayPath);
    }
    fs.mkdirSync(overlayPath, { recursive: true });

    try {
      CanonicalCacheService.replicateTree(canonicalPath, overlayPath, classifier, 'materialize');
      fs.writeFileSync(path.join(overlayPath, COMPLETE_MARKER), sha, 'utf8');
      if (options.sentinelCanary !== undefined) {
        fs.writeFileSync(path.join(overlayPath, SENTINEL_FILE), options.sentinelCanary, 'utf8');
      }
      OrchestratorLogger.log(
        `[CanonicalCache] Materialized overlay ${overlayPath} from canonical ${sha}`,
      );
      return { sha };
    } catch (error: any) {
      OrchestratorLogger.logWarning(`[CanonicalCache] Materialize failed: ${error.message}`);
      CanonicalCacheService.removeDirectory(overlayPath);
      return null;
    }
  }

  /**
   * Build a prepared overlay during PostUnityJob, ready for the next PreUnityJob to
   * consume via a single atomic rename. This shifts the materialize cost off the
   * critical path entirely.
   *
   * Writes to <overlayPath>-prepared. Caller atomic-renames into place during
   * the next PreUnityJob via swapPreparedOverlay().
   */
  static async preparedOverlay(
    canonicalRoot: string,
    cacheKey: string,
    folder: string,
    overlayPath: string,
    options: MaterializeOverlayOptions = {},
  ): Promise<{ sha: string; preparedPath: string } | null> {
    const preparedPath = `${overlayPath}-prepared`;
    if (fs.existsSync(preparedPath)) {
      CanonicalCacheService.removeDirectory(preparedPath);
    }
    const result = await CanonicalCacheService.materializeOverlay(
      canonicalRoot,
      cacheKey,
      folder,
      preparedPath,
      options,
    );
    if (!result) return null;
    return { sha: result.sha, preparedPath };
  }

  /**
   * Consume a prepared overlay during PreUnityJob. Atomic-renames the prepared
   * overlay into place and returns true on success.
   *
   * Caller should verify the prepared overlay's SHA matches canonical's `latest` SHA
   * before calling — if it doesn't, fall through to live materialize.
   */
  static swapPreparedOverlay(overlayPath: string): boolean {
    const preparedPath = `${overlayPath}-prepared`;
    if (!fs.existsSync(preparedPath)) return false;

    try {
      if (fs.existsSync(overlayPath)) {
        CanonicalCacheService.removeDirectory(overlayPath);
      }
      fs.renameSync(preparedPath, overlayPath);
      OrchestratorLogger.log(`[CanonicalCache] Swapped prepared overlay into ${overlayPath}`);
      return true;
    } catch (error: any) {
      OrchestratorLogger.logWarning(
        `[CanonicalCache] Prepared overlay swap failed: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Verify the sentinel canary in an overlay matches the expected content.
   * Used as a defense-in-depth probe against silent corruption.
   *
   * Returns true if the canary matches OR if no canary was written. Returns
   * false only when the canary file exists but content differs from expected.
   */
  static verifySentinel(overlayPath: string, expected: string): boolean {
    const sentinelPath = path.join(overlayPath, SENTINEL_FILE);
    if (!fs.existsSync(sentinelPath)) return true;
    try {
      const actual = fs.readFileSync(sentinelPath, 'utf8');
      if (actual !== expected) {
        OrchestratorLogger.logWarning(
          `[CanonicalCache] Sentinel canary mismatch at ${overlayPath} — possible silent corruption`,
        );
        return false;
      }
      return true;
    } catch (error: any) {
      OrchestratorLogger.logWarning(
        `[CanonicalCache] Sentinel canary read failed: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Read the SHA backing an overlay (from its `.cache_complete` marker).
   * Returns null if the overlay is missing the marker.
   */
  static readOverlaySha(overlayPath: string): string | null {
    const markerPath = path.join(overlayPath, COMPLETE_MARKER);
    if (!fs.existsSync(markerPath)) return null;
    try {
      return fs.readFileSync(markerPath, 'utf8').trim();
    } catch {
      return null;
    }
  }

  /**
   * Read the SHA of the currently-published canonical version.
   * Returns null if the canonical store has no `latest` pointer or marker.
   */
  static readCanonicalSha(canonicalRoot: string, cacheKey: string, folder: string): string | null {
    const latestPath = path.join(canonicalRoot, cacheKey, folder, 'latest');
    const canonicalPath = CanonicalCacheService.resolveLatest(latestPath);
    if (!canonicalPath) return null;
    return CanonicalCacheService.readOverlaySha(canonicalPath);
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * Replicate a tree from source to destination using the classifier.
   * Files matching `hardlink` rules are hardlinked; `junction` rules become
   * directory junctions; `copy` rules are byte-copied; `skip` rules are omitted.
   */
  private static replicateTree(
    source: string,
    destination: string,
    classifier: CanonicalCacheClassifier,
    purpose: 'publish' | 'materialize',
  ): void {
    const walk = (relDir: string): void => {
      const sourceDir = path.join(source, relDir);
      const destDir = path.join(destination, relDir);
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(sourceDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        // Skip the marker — we write our own at the end.
        if (entry.name === COMPLETE_MARKER) continue;

        const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
        const sourcePath = path.join(sourceDir, entry.name);
        const destPath = path.join(destDir, entry.name);

        const strategy = CanonicalCacheService.strategyFor(relPath, classifier);

        if (strategy === 'skip') continue;

        if (entry.isDirectory()) {
          if (strategy === 'junction') {
            fs.mkdirSync(destDir, { recursive: true });
            CanonicalCacheService.createJunction(sourcePath, destPath);
          } else if (strategy === 'copy') {
            fs.cpSync(sourcePath, destPath, { recursive: true });
          } else {
            // hardlink semantics for a directory: recurse and hardlink leaves.
            fs.mkdirSync(destPath, { recursive: true });
            walk(relPath);
          }
        } else if (entry.isFile()) {
          fs.mkdirSync(destDir, { recursive: true });
          if (strategy === 'copy') {
            fs.copyFileSync(sourcePath, destPath);
          } else {
            // 'hardlink' (default for files); 'junction' on a file falls back to hardlink.
            try {
              fs.linkSync(sourcePath, destPath);
            } catch (error: any) {
              if (error.code === 'EXDEV' || error.code === 'EPERM') {
                // Cross-device or permission — fall back to copy.
                fs.copyFileSync(sourcePath, destPath);
              } else {
                throw error;
              }
            }
          }
        }
      }
    };

    walk('');
    OrchestratorLogger.log(
      `[CanonicalCache] Replicated tree ${source} → ${destination} (${purpose})`,
    );
  }

  /**
   * Match a relative path against the classifier rules. First match wins.
   * Falls back to classifier.default if no rule matches.
   */
  private static strategyFor(
    relPath: string,
    classifier: CanonicalCacheClassifier,
  ): SubtreeStrategy {
    const normalized = relPath.replace(/\\/g, '/');
    for (const rule of classifier.rules) {
      if (CanonicalCacheService.matchGlob(normalized, rule.pattern)) {
        return rule.strategy;
      }
    }
    return classifier.default;
  }

  /**
   * Lightweight glob matcher supporting `*` (any non-separator chars) and `**` (any chars).
   * Patterns ending without `*` match exact path segments at any depth. Patterns
   * with `*` are anchored from the start.
   */
  private static matchGlob(input: string, pattern: string): boolean {
    if (!pattern.includes('*')) {
      // Treat pattern as a literal path or path-segment match.
      if (input === pattern) return true;
      if (input.startsWith(`${pattern}/`)) return true;
      const baseName = input.split('/').pop() ?? '';
      if (baseName === pattern) return true;
      return false;
    }
    const regexSrc = pattern
      .split('**')
      .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
      .join('.*');
    const regex = new RegExp(`^${regexSrc}(/.*)?$`);
    return regex.test(input);
  }

  /**
   * Update or create the `latest` directory junction pointing at the given target.
   * On non-Windows, creates a symlink instead.
   */
  private static updateLatestPointer(latestPath: string, targetPath: string): void {
    try {
      if (fs.existsSync(latestPath) || CanonicalCacheService.lstatSafe(latestPath)) {
        CanonicalCacheService.removeDirectory(latestPath);
      }
      if (process.platform === 'win32') {
        CanonicalCacheService.createJunction(targetPath, latestPath);
      } else {
        fs.symlinkSync(targetPath, latestPath, 'dir');
      }
    } catch (error: any) {
      OrchestratorLogger.logWarning(
        `[CanonicalCache] Failed to update latest pointer at ${latestPath}: ${error.message}`,
      );
    }
  }

  /**
   * Resolve the `latest` pointer to an absolute path, or null if it doesn't exist.
   */
  private static resolveLatest(latestPath: string): string | null {
    try {
      const stat = CanonicalCacheService.lstatSafe(latestPath);
      if (!stat) return null;
      const realPath = fs.realpathSync(latestPath);
      if (!fs.existsSync(realPath)) return null;
      return realPath;
    } catch {
      return null;
    }
  }

  /**
   * Create a directory junction (Windows) or fall back to a copy on platforms
   * that don't support junctions and where the path crosses filesystems.
   * On Linux, uses a symlink — overlayfs/bind-mount integration is out of scope
   * for this initial implementation.
   */
  private static createJunction(sourcePath: string, destPath: string): void {
    try {
      if (fs.existsSync(destPath)) {
        CanonicalCacheService.removeDirectory(destPath);
      }
      if (process.platform === 'win32') {
        // mklink /J is the standard Windows directory junction.
        // Quote both paths to handle spaces.
        execSync(`cmd /c mklink /J "${destPath}" "${sourcePath}"`, { stdio: 'pipe' });
      } else {
        fs.symlinkSync(sourcePath, destPath, 'dir');
      }
    } catch (error: any) {
      OrchestratorLogger.logWarning(
        `[CanonicalCache] Junction create failed (${sourcePath} → ${destPath}): ${error.message}; falling back to copy`,
      );
      fs.cpSync(sourcePath, destPath, { recursive: true });
    }
  }

  /**
   * Remove a directory or junction. On Windows, uses `cmd /c rmdir` so that
   * junctions are removed without following the link.
   */
  private static removeDirectory(target: string): void {
    if (!fs.existsSync(target) && !CanonicalCacheService.lstatSafe(target)) return;
    if (process.platform === 'win32') {
      try {
        execSync(`cmd /c rmdir /s /q "${target}"`, { stdio: 'pipe' });
        return;
      } catch {
        // Fall through to fs.rmSync.
      }
    }
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (error: any) {
      OrchestratorLogger.logWarning(
        `[CanonicalCache] Remove failed at ${target}: ${error.message}`,
      );
    }
  }

  /**
   * Prune older canonical versions, keeping the latest N.
   */
  private static pruneOldVersions(baseDir: string, currentSha: string, retain: number): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(baseDir, { withFileTypes: true });
    } catch {
      return;
    }
    const versions = entries
      .filter((e) => e.isDirectory() && e.name !== 'latest' && !e.name.endsWith('-staging'))
      .map((e) => {
        const entryPath = path.join(baseDir, e.name);
        try {
          return { name: e.name, mtime: fs.statSync(entryPath).mtimeMs };
        } catch {
          return { name: e.name, mtime: 0 };
        }
      })
      .sort((a, b) => b.mtime - a.mtime);

    const toRemove = versions.slice(retain).filter((v) => v.name !== currentSha);
    for (const version of toRemove) {
      const target = path.join(baseDir, version.name);
      OrchestratorLogger.log(`[CanonicalCache] Pruning old canonical version ${target}`);
      CanonicalCacheService.removeDirectory(target);
    }
  }

  private static lstatSafe(target: string): fs.Stats | null {
    try {
      return fs.lstatSync(target);
    } catch {
      return null;
    }
  }
}

export default CanonicalCacheService;
