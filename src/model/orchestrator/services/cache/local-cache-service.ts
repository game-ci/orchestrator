import fs from 'node:fs';
import path from 'node:path';
import { OrchestratorSystem } from '../core/orchestrator-system';
import OrchestratorLogger from '../core/orchestrator-logger';
import { getEngine } from '../../../engine';

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

  /**
   * Restore engine-specific cache folders from the local filesystem.
   * Iterates over getEngine().cacheFolders (e.g. ['Library'] for Unity).
   * Returns true if any cache was restored.
   */
  static async restoreEngineCache(projectPath: string, cacheRoot: string, cacheKey: string): Promise<boolean> {
    let restored = false;
    for (const folder of getEngine().cacheFolders) {
      if (await LocalCacheService.restoreCacheFolder(projectPath, cacheRoot, cacheKey, folder)) {
        restored = true;
      }
    }

    return restored;
  }

  /** @deprecated Use restoreEngineCache() — kept for backward compatibility */
  static async restoreLibraryCache(projectPath: string, cacheRoot: string, cacheKey: string): Promise<boolean> {
    return LocalCacheService.restoreEngineCache(projectPath, cacheRoot, cacheKey);
  }

  /**
   * Save engine-specific cache folders to the local cache.
   * Iterates over getEngine().cacheFolders (e.g. ['Library'] for Unity).
   */
  static async saveEngineCache(projectPath: string, cacheRoot: string, cacheKey: string): Promise<void> {
    for (const folder of getEngine().cacheFolders) {
      await LocalCacheService.saveCacheFolder(projectPath, cacheRoot, cacheKey, folder);
    }
  }

  /** @deprecated Use saveEngineCache() — kept for backward compatibility */
  static async saveLibraryCache(projectPath: string, cacheRoot: string, cacheKey: string): Promise<void> {
    return LocalCacheService.saveEngineCache(projectPath, cacheRoot, cacheKey);
  }

  private static async restoreCacheFolder(
    projectPath: string,
    cacheRoot: string,
    cacheKey: string,
    folder: string,
  ): Promise<boolean> {
    const cachePath = path.join(cacheRoot, cacheKey, folder);

    try {
      if (!fs.existsSync(cachePath)) {
        OrchestratorLogger.log(`[LocalCache] ${folder} cache miss: ${cachePath}`);

        return false;
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
      OrchestratorLogger.log(`[LocalCache] ${folder} cache restored successfully`);

      return true;
    } catch (error: any) {
      OrchestratorLogger.logWarning(`[LocalCache] ${folder} cache restore failed: ${error.message}`);

      return false;
    }
  }

  private static async saveCacheFolder(
    projectPath: string,
    cacheRoot: string,
    cacheKey: string,
    folder: string,
  ): Promise<void> {
    const folderPath = path.join(projectPath, folder);

    try {
      if (!fs.existsSync(folderPath)) {
        OrchestratorLogger.log(`[LocalCache] ${folder} folder does not exist, skipping save`);

        return;
      }

      const entries = fs.readdirSync(folderPath);
      if (entries.length === 0) {
        OrchestratorLogger.log(`[LocalCache] ${folder} folder is empty, skipping save`);

        return;
      }

      const cachePath = path.join(cacheRoot, cacheKey, folder);
      fs.mkdirSync(cachePath, { recursive: true });

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

  /**
   * Restore LFS cache from the local filesystem.
   * Returns true if cache was restored, false on cache miss.
   */
  static async restoreLfsCache(repoPath: string, cacheRoot: string, cacheKey: string): Promise<boolean> {
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
      await OrchestratorSystem.Run(`tar -xf "${tarPath}" -C "${path.join(repoPath, '.git')}"`, true);
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
      await OrchestratorSystem.Run(`tar -cf "${tarPath}" -C "${path.join(repoPath, '.git')}" lfs`, true);
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
          OrchestratorLogger.logWarning(`[LocalCache] Failed to garbage collect ${entryPath}: ${error.message}`);
        }
      }

      OrchestratorLogger.log(`[LocalCache] Garbage collection complete: ${removedCount} entries removed`);
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
}
