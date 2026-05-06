import fs from 'node:fs';
import path from 'node:path';
import { OrchestratorSystem } from '../core/orchestrator-system';
import OrchestratorLogger from '../core/orchestrator-logger';
import { getEngine } from '../../../engine';

export interface LocalCacheRestoreOptions {
  fallbackKeys?: string[];
  validateRestored?: boolean;
  restoreMode?: 'tar' | 'move-directory' | 'copy-directory';
}

export interface LocalCacheSaveOptions {
  diagnostics?: { crashEvidenceFound?: boolean };
  skipOnCrashEvidence?: boolean;
  skipOnLfsPointerPoisoning?: boolean;
  saveMode?: 'tar' | 'move-directory' | 'copy-directory';
}

export class LocalCacheService {
  /**
   * Resolve the cache root directory based on build parameters and environment.
   * Priority: localCacheRoot > RUNNER_TEMP/game-ci-cache > .game-ci/cache
   */
  static resolveCacheRoot(buildParameters: { localCacheRoot: string }): string {
    if (buildParameters.localCacheRoot) {
      return buildParameters.localCacheRoot;
    }

    if (process.env.RUNNER_TEMP) {
      return path.join(process.env.RUNNER_TEMP, 'game-ci-cache');
    }

    return path.join(process.cwd(), '.game-ci', 'cache');
  }

  /**
   * Generate a sanitized cache key from build parameters.
   * Non-alphanumeric characters (except hyphens) are replaced with underscores.
   */
  static generateCacheKey(targetPlatform: string, unityVersion: string, branch: string): string {
    const raw = `${targetPlatform}-${unityVersion}-${branch}`;

    return raw.replace(/[^a-zA-Z0-9-]/g, '_');
  }

  static generateCacheKeyCandidates(
    cacheRoot: string,
    targetPlatform: string,
    unityVersion: string,
    branch: string,
    explicitFallbackKeys: string[] = [],
  ): string[] {
    const exactKey = LocalCacheService.generateCacheKey(targetPlatform, unityVersion, branch);
    const candidates = new Set<string>([exactKey]);

    for (const key of explicitFallbackKeys) {
      if (key) candidates.add(key);
    }

    if (!fs.existsSync(cacheRoot)) {
      return Array.from(candidates);
    }

    try {
      const platformPrefix = targetPlatform.replace(/[^a-zA-Z0-9-]/g, '_');
      const versionPart = unityVersion.replace(/[^a-zA-Z0-9-]/g, '_');
      const entries = fs
        .readdirSync(cacheRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((key) => key !== exactKey);

      const scored = entries
        .map((key) => {
          let score = 0;
          if (key.startsWith(`${platformPrefix}-${versionPart}-`)) score += 30;
          if (key.startsWith(`${platformPrefix}-`)) score += 20;
          if (key.includes(`-${versionPart}-`)) score += 10;

          return { key, score };
        })
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

      for (const candidate of scored) {
        candidates.add(candidate.key);
      }
    } catch (error: any) {
      OrchestratorLogger.logWarning(
        `[LocalCache] Failed to discover fallback cache keys: ${error.message}`,
      );
    }

    return Array.from(candidates);
  }

  /**
   * Restore engine-specific cache folders from the local filesystem.
   * Iterates over getEngine().cacheFolders (e.g. ['Library'] for Unity).
   * Returns true if any cache was restored.
   */
  static async restoreEngineCache(
    projectPath: string,
    cacheRoot: string,
    cacheKey: string,
    options: LocalCacheRestoreOptions = {},
  ): Promise<boolean> {
    let restored = false;
    for (const folder of getEngine().cacheFolders) {
      if (
        await LocalCacheService.restoreCacheFolder(
          projectPath,
          cacheRoot,
          cacheKey,
          folder,
          options,
        )
      ) {
        restored = true;
      }
    }

    return restored;
  }

  /** @deprecated Use restoreEngineCache() — kept for backward compatibility */
  static async restoreLibraryCache(
    projectPath: string,
    cacheRoot: string,
    cacheKey: string,
  ): Promise<boolean> {
    return LocalCacheService.restoreEngineCache(projectPath, cacheRoot, cacheKey);
  }

  /**
   * Save engine-specific cache folders to the local cache.
   * Iterates over getEngine().cacheFolders (e.g. ['Library'] for Unity).
   */
  static async saveEngineCache(
    projectPath: string,
    cacheRoot: string,
    cacheKey: string,
    options: LocalCacheSaveOptions = {},
  ): Promise<void> {
    for (const folder of getEngine().cacheFolders) {
      await LocalCacheService.saveCacheFolder(projectPath, cacheRoot, cacheKey, folder, options);
    }
  }

  /** @deprecated Use saveEngineCache() — kept for backward compatibility */
  static async saveLibraryCache(
    projectPath: string,
    cacheRoot: string,
    cacheKey: string,
  ): Promise<void> {
    return LocalCacheService.saveEngineCache(projectPath, cacheRoot, cacheKey);
  }

  private static async restoreCacheFolder(
    projectPath: string,
    cacheRoot: string,
    cacheKey: string,
    folder: string,
    options: LocalCacheRestoreOptions = {},
  ): Promise<boolean> {
    const candidates = [
      cacheKey,
      ...(options.fallbackKeys || []).filter((key) => key !== cacheKey),
    ];

    for (const candidateKey of candidates) {
      const isFallback = candidateKey !== cacheKey;
      const candidateOptions =
        isFallback && options.restoreMode === 'move-directory'
          ? { ...options, restoreMode: 'copy-directory' as const }
          : options;

      if (
        await LocalCacheService.restoreCacheFolderCandidate(
          projectPath,
          cacheRoot,
          candidateKey,
          folder,
          candidateOptions,
        )
      ) {
        if (isFallback) {
          LocalCacheService.clearProfileDependentArtifacts(projectPath, folder);
        }

        return true;
      }
    }

    return false;
  }

  private static async restoreCacheFolderCandidate(
    projectPath: string,
    cacheRoot: string,
    cacheKey: string,
    folder: string,
    options: LocalCacheRestoreOptions = {},
  ): Promise<boolean> {
    const cachePath = path.join(cacheRoot, cacheKey, folder);

    try {
      if (!fs.existsSync(cachePath)) {
        OrchestratorLogger.log(`[LocalCache] ${folder} cache miss: ${cachePath}`);

        return false;
      }

      if (options.restoreMode && options.restoreMode !== 'tar') {
        return LocalCacheService.restoreDirectoryCache(projectPath, cachePath, folder, options);
      }

      const files = fs.readdirSync(cachePath).filter((f) => f.endsWith('.tar'));
      if (files.length === 0) {
        OrchestratorLogger.log(`[LocalCache] ${folder} cache miss (no tar files): ${cachePath}`);

        return false;
      }

      // Find the latest tar file by modification time
      let latestFile = files[0];
      let latestMtime = fs.statSync(path.join(cachePath, files[0])).mtimeMs;
      for (let i = 1; i < files.length; i++) {
        const mtime = fs.statSync(path.join(cachePath, files[i])).mtimeMs;
        if (mtime > latestMtime) {
          latestMtime = mtime;
          latestFile = files[i];
        }
      }

      const tarPath = path.join(cachePath, latestFile);
      const dest = path.join(projectPath, folder);

      // Ensure destination exists
      fs.mkdirSync(dest, { recursive: true });

      OrchestratorLogger.log(`[LocalCache] ${folder} cache hit: restoring from ${tarPath}`);
      await OrchestratorSystem.Run(`tar -xf "${tarPath}" -C "${projectPath}"`, true);

      if (
        options.validateRestored !== false &&
        !LocalCacheService.isCacheFolderComplete(dest, folder)
      ) {
        OrchestratorLogger.logWarning(
          `[LocalCache] ${folder} restored from ${tarPath} is incomplete; discarding`,
        );
        fs.rmSync(dest, { recursive: true, force: true });

        return false;
      }

      OrchestratorLogger.log(`[LocalCache] ${folder} cache restored successfully`);

      return true;
    } catch (error: any) {
      OrchestratorLogger.logWarning(
        `[LocalCache] ${folder} cache restore failed: ${error.message}`,
      );

      return false;
    }
  }

  private static async saveCacheFolder(
    projectPath: string,
    cacheRoot: string,
    cacheKey: string,
    folder: string,
    options: LocalCacheSaveOptions = {},
  ): Promise<void> {
    const folderPath = path.join(projectPath, folder);

    try {
      if (options.skipOnCrashEvidence && options.diagnostics?.crashEvidenceFound) {
        OrchestratorLogger.logWarning(
          `[LocalCache] ${folder} save skipped because Unity crash evidence was found`,
        );

        return;
      }

      if (!fs.existsSync(folderPath)) {
        OrchestratorLogger.log(`[LocalCache] ${folder} folder does not exist, skipping save`);

        return;
      }

      const entries = fs.readdirSync(folderPath);
      if (entries.length === 0) {
        OrchestratorLogger.log(`[LocalCache] ${folder} folder is empty, skipping save`);

        return;
      }

      if (!LocalCacheService.isCacheFolderComplete(folderPath, folder)) {
        OrchestratorLogger.logWarning(`[LocalCache] ${folder} folder is incomplete, skipping save`);

        return;
      }

      // LFS pointer poisoning detection: skip save if unhydrated LFS pointers found
      if (options.skipOnLfsPointerPoisoning) {
        const poisonedFiles = LocalCacheService.detectLfsPointerPoisoning(projectPath);
        if (poisonedFiles.length > 0) {
          OrchestratorLogger.logWarning(
            `[LocalCache] ${folder} cache save SKIPPED: ${poisonedFiles.length} LFS pointer file(s) detected. ` +
              `Saving this cache would poison future restores.`,
          );

          return;
        }
      }

      const cachePath = path.join(cacheRoot, cacheKey, folder);
      fs.mkdirSync(cachePath, { recursive: true });

      if (options.saveMode && options.saveMode !== 'tar') {
        LocalCacheService.saveDirectoryCache(folderPath, cachePath, options.saveMode);

        return;
      }

      const timestamp = Date.now();
      const prefix = folder.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
      const tarName = `${prefix}-${timestamp}.tar`;
      const tarPath = path.join(cachePath, tarName);

      OrchestratorLogger.log(`[LocalCache] Saving ${folder} cache to ${tarPath}`);
      await OrchestratorSystem.Run(`tar -cf "${tarPath}" -C "${projectPath}" "${folder}"`, true);
      OrchestratorLogger.log(`[LocalCache] ${folder} cache saved successfully`);

      // Clean up old entries - keep latest 2
      await LocalCacheService.cleanupOldEntries(cachePath, 2);
    } catch (error: any) {
      OrchestratorLogger.logWarning(`[LocalCache] ${folder} cache save failed: ${error.message}`);
    }
  }

  private static restoreDirectoryCache(
    projectPath: string,
    cachePath: string,
    folder: string,
    options: LocalCacheRestoreOptions,
  ): boolean {
    const dest = path.join(projectPath, folder);

    try {
      if (!LocalCacheService.isCacheFolderComplete(cachePath, folder)) {
        OrchestratorLogger.log(
          `[LocalCache] ${folder} directory cache miss or incomplete: ${cachePath}`,
        );

        return false;
      }

      const entries = fs.readdirSync(cachePath);
      if (entries.length > 0 && entries.every((entry) => entry.endsWith('.tar'))) {
        OrchestratorLogger.logWarning(
          `[LocalCache] ${folder} cache at ${cachePath} contains tar archives; use localCacheMode=tar to restore it`,
        );

        return false;
      }

      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }

      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (options.restoreMode === 'copy-directory') {
        fs.cpSync(cachePath, dest, { recursive: true });
      } else {
        fs.renameSync(cachePath, dest);
      }

      if (
        options.validateRestored !== false &&
        !LocalCacheService.isCacheFolderComplete(dest, folder)
      ) {
        OrchestratorLogger.logWarning(
          `[LocalCache] ${folder} directory cache restored incomplete; discarding`,
        );
        fs.rmSync(dest, { recursive: true, force: true });

        return false;
      }

      // DAG file repair: fix stale workspace paths in Bee DAG files
      LocalCacheService.repairDagFiles(dest);

      OrchestratorLogger.log(`[LocalCache] ${folder} directory cache restored successfully`);

      return true;
    } catch (error: any) {
      OrchestratorLogger.logWarning(
        `[LocalCache] ${folder} directory cache restore failed: ${error.message}`,
      );

      return false;
    }
  }

  /**
   * Scan Library/Bee/ for .dag files and replace stale workspace paths
   * with the current workspace path. This prevents "stale DAG" errors
   * when Library cache is shared across runners with different workspace paths.
   */
  static repairDagFiles(libraryPath: string): number {
    const beePath = path.join(libraryPath, 'Bee');
    if (!fs.existsSync(beePath)) return 0;

    const currentWorkspace = path.resolve(path.join(libraryPath, '..'));
    let repaired = 0;

    const scanAndRepair = (directory: string): void => {
      let names: string[];
      try {
        names = fs.readdirSync(directory) as string[];
      } catch {
        return;
      }

      for (const name of names) {
        const fullPath = path.join(directory, name);
        try {
          const stat = fs.statSync(fullPath);
          if (typeof stat.isDirectory === 'function' && stat.isDirectory()) {
            scanAndRepair(fullPath);
            continue;
          }
        } catch {
          continue;
        }

        if (!name.endsWith('.dag')) continue;

        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          // Look for absolute paths that differ from current workspace
          // DAG files contain paths like D:\actions-runner\_work\GameClient\GameClient
          const workspacePattern =
            /([A-Z]:[\\/][^\s"';,\n]+[\\/])(?=Library[\\/]|Assets[\\/]|Packages[\\/]|Temp[\\/])/gi;
          const matches = content.match(workspacePattern);
          if (!matches) continue;

          // Find paths that differ from the current workspace
          const normalizedCurrent = currentWorkspace.replace(/\\/g, '/').toLowerCase();
          const staleRoots = new Set<string>();
          for (const match of matches) {
            const normalizedMatch = match.replace(/\\/g, '/').toLowerCase().replace(/\/$/, '');
            if (normalizedMatch !== normalizedCurrent) {
              staleRoots.add(match.replace(/[\\/]$/, ''));
            }
          }

          if (staleRoots.size === 0) continue;

          let updatedContent = content;
          for (const staleRoot of staleRoots) {
            // Replace preserving separator style (forward or back slash)
            const escapedStale = staleRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            updatedContent = updatedContent.replace(
              new RegExp(escapedStale, 'gi'),
              currentWorkspace,
            );
          }

          if (updatedContent !== content) {
            fs.writeFileSync(fullPath, updatedContent, 'utf8');
            repaired++;
          }
        } catch {
          // Skip unreadable DAG files
        }
      }
    };

    scanAndRepair(beePath);

    if (repaired > 0) {
      OrchestratorLogger.log(`[LocalCache] Repaired ${repaired} stale DAG file(s) in Bee/`);
    }

    return repaired;
  }

  /**
   * Detect LFS pointer poisoning in Library/ScriptAssemblies/*.dll and
   * other key binary locations. If any file < 200 bytes contains the
   * LFS pointer header, the cache is poisoned and should not be saved.
   *
   * Returns list of poisoned file paths (empty = safe to save).
   */
  static detectLfsPointerPoisoning(projectPath: string): string[] {
    const poisoned: string[] = [];
    const LFS_HEADER = 'version https://git-lfs.github.com/spec/v1';
    const scanTargets = [
      path.join(projectPath, 'Library', 'ScriptAssemblies'),
      path.join(projectPath, 'Library', 'PackageCache'),
    ];

    for (const target of scanTargets) {
      if (!fs.existsSync(target)) continue;
      LocalCacheService.scanForLfsPointers(target, LFS_HEADER, poisoned);
    }

    if (poisoned.length > 0) {
      OrchestratorLogger.logWarning(
        `[LocalCache] LFS pointer poisoning detected in ${poisoned.length} file(s)`,
      );
      for (const file of poisoned.slice(0, 5)) {
        OrchestratorLogger.logWarning(`[LocalCache]   Poisoned: ${file}`);
      }
    }

    return poisoned;
  }

  private static scanForLfsPointers(
    directory: string,
    lfsHeader: string,
    results: string[],
    maxBytes = 200,
  ): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        LocalCacheService.scanForLfsPointers(fullPath, lfsHeader, results, maxBytes);
        continue;
      }

      if (!entry.isFile()) continue;
      const ext = entry.name.toLowerCase();
      if (!ext.endsWith('.dll') && !ext.endsWith('.so') && !ext.endsWith('.dylib')) continue;

      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > maxBytes || stat.size === 0) continue;

        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.startsWith(lfsHeader)) {
          results.push(fullPath);
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  private static saveDirectoryCache(
    folderPath: string,
    cachePath: string,
    saveMode: 'move-directory' | 'copy-directory',
  ): void {
    if (fs.existsSync(cachePath)) {
      fs.rmSync(cachePath, { recursive: true, force: true });
    }

    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    if (saveMode === 'copy-directory') {
      fs.cpSync(folderPath, cachePath, { recursive: true });
    } else {
      fs.renameSync(folderPath, cachePath);
    }

    OrchestratorLogger.log(
      `[LocalCache] ${path.basename(folderPath)} directory cache saved successfully`,
    );
  }

  /**
   * Restore LFS cache from the local filesystem.
   * Returns true if cache was restored, false on cache miss.
   */
  static async restoreLfsCache(
    repoPath: string,
    cacheRoot: string,
    cacheKey: string,
  ): Promise<boolean> {
    const cachePath = path.join(cacheRoot, cacheKey, 'lfs');

    try {
      if (!fs.existsSync(cachePath)) {
        OrchestratorLogger.log(`[LocalCache] LFS cache miss: ${cachePath}`);

        return false;
      }

      const files = fs.readdirSync(cachePath).filter((f) => f.endsWith('.tar'));
      if (files.length === 0) {
        OrchestratorLogger.log(`[LocalCache] LFS cache miss (no tar files): ${cachePath}`);

        return false;
      }

      // Find the latest tar file by modification time
      let latestFile = files[0];
      let latestMtime = fs.statSync(path.join(cachePath, files[0])).mtimeMs;
      for (let i = 1; i < files.length; i++) {
        const mtime = fs.statSync(path.join(cachePath, files[i])).mtimeMs;
        if (mtime > latestMtime) {
          latestMtime = mtime;
          latestFile = files[i];
        }
      }

      const tarPath = path.join(cachePath, latestFile);
      const lfsDest = path.join(repoPath, '.git', 'lfs');

      // Ensure destination exists
      fs.mkdirSync(lfsDest, { recursive: true });

      OrchestratorLogger.log(`[LocalCache] LFS cache hit: restoring from ${tarPath}`);
      await OrchestratorSystem.Run(
        `tar -xf "${tarPath}" -C "${path.join(repoPath, '.git')}"`,
        true,
      );
      OrchestratorLogger.log(`[LocalCache] LFS cache restored successfully`);

      return true;
    } catch (error: any) {
      OrchestratorLogger.logWarning(`[LocalCache] LFS cache restore failed: ${error.message}`);

      return false;
    }
  }

  /**
   * Save .git/lfs folder to the local cache as a tar archive.
   * Keeps only the latest 2 cache entries.
   */
  static async saveLfsCache(repoPath: string, cacheRoot: string, cacheKey: string): Promise<void> {
    const lfsPath = path.join(repoPath, '.git', 'lfs');

    try {
      if (!fs.existsSync(lfsPath)) {
        OrchestratorLogger.log(`[LocalCache] LFS folder does not exist, skipping save`);

        return;
      }

      const entries = fs.readdirSync(lfsPath);
      if (entries.length === 0) {
        OrchestratorLogger.log(`[LocalCache] LFS folder is empty, skipping save`);

        return;
      }

      const cachePath = path.join(cacheRoot, cacheKey, 'lfs');
      fs.mkdirSync(cachePath, { recursive: true });

      const timestamp = Date.now();
      const tarName = `lfs-${timestamp}.tar`;
      const tarPath = path.join(cachePath, tarName);

      OrchestratorLogger.log(`[LocalCache] Saving LFS cache to ${tarPath}`);
      await OrchestratorSystem.Run(
        `tar -cf "${tarPath}" -C "${path.join(repoPath, '.git')}" lfs`,
        true,
      );
      OrchestratorLogger.log(`[LocalCache] LFS cache saved successfully`);

      // Clean up old entries - keep latest 2
      await LocalCacheService.cleanupOldEntries(cachePath, 2);
    } catch (error: any) {
      OrchestratorLogger.logWarning(`[LocalCache] LFS cache save failed: ${error.message}`);
    }
  }

  /**
   * Remove cache entries older than maxAgeDays from the cache root.
   */
  static async garbageCollect(cacheRoot: string, maxAgeDays: number = 7): Promise<void> {
    try {
      if (!fs.existsSync(cacheRoot)) {
        OrchestratorLogger.log(`[LocalCache] Cache root does not exist, nothing to collect`);

        return;
      }

      const now = Date.now();
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
      const entries = fs.readdirSync(cacheRoot);
      let removedCount = 0;

      for (const entry of entries) {
        const entryPath = path.join(cacheRoot, entry);
        try {
          const stat = fs.statSync(entryPath);
          if (stat.isDirectory() && now - stat.mtimeMs > maxAgeMs) {
            fs.rmSync(entryPath, { recursive: true, force: true });
            removedCount++;
            OrchestratorLogger.log(`[LocalCache] Garbage collected: ${entryPath}`);
          }
        } catch (error: any) {
          OrchestratorLogger.logWarning(
            `[LocalCache] Failed to garbage collect ${entryPath}: ${error.message}`,
          );
        }
      }

      OrchestratorLogger.log(
        `[LocalCache] Garbage collection complete: ${removedCount} entries removed`,
      );
    } catch (error: any) {
      OrchestratorLogger.logWarning(`[LocalCache] Garbage collection failed: ${error.message}`);
    }
  }

  /**
   * Clean up old tar files in a cache directory, keeping only the latest N.
   */
  private static async cleanupOldEntries(cachePath: string, keepCount: number): Promise<void> {
    try {
      const files = fs
        .readdirSync(cachePath)
        .filter((f) => f.endsWith('.tar'))
        .map((f) => ({
          name: f,
          mtime: fs.statSync(path.join(cachePath, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > keepCount) {
        const toRemove = files.slice(keepCount);
        for (const file of toRemove) {
          const filePath = path.join(cachePath, file.name);
          fs.unlinkSync(filePath);
          OrchestratorLogger.log(`[LocalCache] Cleaned up old cache entry: ${filePath}`);
        }
      }
    } catch (error: any) {
      OrchestratorLogger.logWarning(`[LocalCache] Cleanup of old entries failed: ${error.message}`);
    }
  }

  static isCacheFolderComplete(folderPath: string, folder: string): boolean {
    try {
      if (!fs.existsSync(folderPath)) return false;

      const entries = fs.readdirSync(folderPath);
      if (entries.length === 0) return false;

      if (folder.replace(/\\/g, '/').split('/').pop() !== 'Library') {
        return true;
      }

      const skeletonMarkers = [
        path.join(folderPath, 'ArtifactDB'),
        path.join(folderPath, 'assetDatabase.info'),
      ];
      for (const marker of skeletonMarkers) {
        if (fs.existsSync(marker)) {
          const stat = fs.statSync(marker);
          if (stat.size === 0) {
            return false;
          }
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  static clearProfileDependentArtifacts(projectPath: string, folder: string): string[] {
    const folderName = folder.replace(/\\/g, '/').split('/').pop();
    if (folderName !== 'Library') {
      return [];
    }

    const libraryPath = path.join(projectPath, folder);

    return LocalCacheService.removeCacheSubfolders(libraryPath, ['ScriptAssemblies', 'Bee']);
  }

  static removeCacheSubfolders(rootPath: string, subfolders: string[]): string[] {
    const removed: string[] = [];

    for (const subfolder of subfolders) {
      const target = path.join(rootPath, subfolder);
      try {
        if (fs.existsSync(target)) {
          fs.rmSync(target, { recursive: true, force: true });
          removed.push(target);
          OrchestratorLogger.log(`[LocalCache] Cleared profile-dependent cache folder: ${target}`);
        }
      } catch (error: any) {
        OrchestratorLogger.logWarning(`[LocalCache] Failed to clear ${target}: ${error.message}`);
      }
    }

    return removed;
  }
}
