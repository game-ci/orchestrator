import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CanonicalCacheService } from './canonical-cache-service';

vi.mock('../core/orchestrator-logger', () => ({
  __esModule: true,
  default: {
    log: vi.fn(),
    logWarning: vi.fn(),
    error: vi.fn(),
  },
}));

/**
 * Tests for CanonicalCacheService.
 *
 * Hardlink semantics are exercised against the real filesystem (no fs mocking) so
 * the OS hardlink primitive is actually validated. Tests gracefully skip on
 * platforms / volumes that don't support hardlinks via isCapable().
 */

const SUITE_TMP = path.join(os.tmpdir(), `canonical-cache-${Date.now()}`);

function makeFileTree(root: string, layout: Record<string, string | null>): void {
  for (const [rel, content] of Object.entries(layout)) {
    const fullPath = path.join(root, rel);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    if (content === null) {
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      fs.writeFileSync(fullPath, content);
    }
  }
}

describe('CanonicalCacheService', () => {
  let probeRoot: string;
  let canonicalRoot: string;

  beforeAll(() => {
    fs.mkdirSync(SUITE_TMP, { recursive: true });
  });

  beforeEach(() => {
    fs.mkdirSync(SUITE_TMP, { recursive: true });
    probeRoot = fs.mkdtempSync(path.join(SUITE_TMP, 'probe-'));
    canonicalRoot = fs.mkdtempSync(path.join(SUITE_TMP, 'canonical-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(probeRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
    try {
      fs.rmSync(canonicalRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  describe('resolveCanonicalRoot', () => {
    it('returns canonicalCacheRoot when set', () => {
      const result = CanonicalCacheService.resolveCanonicalRoot('/explicit/path', '/local/cache');
      expect(result).toBe('/explicit/path');
    });

    it('falls back to <localCacheRoot>/canonical when canonicalCacheRoot empty', () => {
      const result = CanonicalCacheService.resolveCanonicalRoot('', '/local/cache');
      expect(result).toBe(path.join('/local/cache', 'canonical'));
    });
  });

  describe('defaultUnityClassifier', () => {
    it('routes PackageCache subdirectories to junction strategy', () => {
      const classifier = CanonicalCacheService.defaultUnityClassifier();
      const rule = classifier.rules.find((r) => r.pattern === 'PackageCache/*');
      expect(rule).toBeDefined();
      expect(rule!.strategy).toBe('junction');
    });

    it('routes DAG companion files to copy strategy', () => {
      const classifier = CanonicalCacheService.defaultUnityClassifier();
      const dagRule = classifier.rules.find((r) => r.pattern === 'Bee/*.dag');
      expect(dagRule!.strategy).toBe('copy');
      const dagOutputRule = classifier.rules.find((r) => r.pattern === 'Bee/*.dag.outputdata');
      expect(dagOutputRule!.strategy).toBe('copy');
    });

    it('routes editor session state to skip strategy', () => {
      const classifier = CanonicalCacheService.defaultUnityClassifier();
      const editorRule = classifier.rules.find((r) => r.pattern === 'EditorOnly');
      expect(editorRule!.strategy).toBe('skip');
    });

    it('defaults unknown subtrees to hardlink', () => {
      const classifier = CanonicalCacheService.defaultUnityClassifier();
      expect(classifier.default).toBe('hardlink');
    });
  });

  describe('isCapable', () => {
    it('returns true on a filesystem that supports hardlinks', () => {
      const result = CanonicalCacheService.isCapable(probeRoot);
      // On Windows NTFS, Linux ext4, macOS APFS this should pass.
      // Tests run on Linux Jest CI by default — this asserts hardlinks work in tmpdir.
      expect(result).toBe(true);
    });
  });

  describe('publishCanonical and materializeOverlay', () => {
    it('publishes a runner cache as canonical and materializes an overlay back', async () => {
      if (!CanonicalCacheService.isCapable(canonicalRoot)) {
        // Skip on filesystems that don't support hardlinks.
        return;
      }

      const runnerLibrary = fs.mkdtempSync(path.join(SUITE_TMP, 'runner-'));
      makeFileTree(runnerLibrary, {
        'ScriptAssemblies/Game.dll': 'compiled-bytes',
        'Artifacts/imported.dat': 'asset-bytes',
        'PackageManager/projectResolution.json': '{"workspace": "/runner-1"}',
      });

      const publishResult = await CanonicalCacheService.publishCanonical(
        runnerLibrary,
        canonicalRoot,
        'WindowsStandalone-2021_3-main',
        'Library',
      );

      expect(publishResult).not.toBeNull();
      expect(publishResult!.sha).toMatch(/^[0-9a-f]+$/);
      expect(fs.existsSync(publishResult!.canonicalPath)).toBe(true);
      expect(fs.existsSync(path.join(publishResult!.canonicalPath, '.cache_complete'))).toBe(true);

      const overlayPath = fs.mkdtempSync(path.join(SUITE_TMP, 'overlay-'));
      // remove the placeholder dir so materialize gets a clean slate
      fs.rmSync(overlayPath, { recursive: true, force: true });

      const materializeResult = await CanonicalCacheService.materializeOverlay(
        canonicalRoot,
        'WindowsStandalone-2021_3-main',
        'Library',
        overlayPath,
      );

      expect(materializeResult).not.toBeNull();
      expect(materializeResult!.sha).toBe(publishResult!.sha);
      expect(fs.existsSync(path.join(overlayPath, 'ScriptAssemblies', 'Game.dll'))).toBe(true);
      expect(fs.existsSync(path.join(overlayPath, 'Artifacts', 'imported.dat'))).toBe(true);

      fs.rmSync(runnerLibrary, { recursive: true, force: true });
      fs.rmSync(overlayPath, { recursive: true, force: true });
    });

    it('returns null when no canonical version exists for the cache key', async () => {
      const overlayPath = fs.mkdtempSync(path.join(SUITE_TMP, 'overlay-'));
      fs.rmSync(overlayPath, { recursive: true, force: true });

      const result = await CanonicalCacheService.materializeOverlay(
        canonicalRoot,
        'unknown-key',
        'Library',
        overlayPath,
      );

      expect(result).toBeNull();
    });

    it('preserves canonical when a publish staging dir is left orphaned', async () => {
      if (!CanonicalCacheService.isCapable(canonicalRoot)) return;

      const runnerLibrary = fs.mkdtempSync(path.join(SUITE_TMP, 'runner-'));
      makeFileTree(runnerLibrary, {
        'ScriptAssemblies/Game.dll': 'first-publish',
      });

      const first = await CanonicalCacheService.publishCanonical(
        runnerLibrary,
        canonicalRoot,
        'cache-key-A',
        'Library',
      );
      expect(first).not.toBeNull();

      // Simulate an orphan staging dir (cancelled mid-publish from a different runner).
      const baseDir = path.join(canonicalRoot, 'cache-key-A', 'Library');
      const orphanStaging = path.join(baseDir, 'orphan-sha-staging');
      fs.mkdirSync(orphanStaging, { recursive: true });
      fs.writeFileSync(path.join(orphanStaging, 'partial.dll'), 'partial');

      // Re-publish a different version. Orphan staging should be cleaned up where applicable
      // and the original canonical version should remain readable.
      fs.writeFileSync(path.join(runnerLibrary, 'ScriptAssemblies', 'Game.dll'), 'second-publish');
      const second = await CanonicalCacheService.publishCanonical(
        runnerLibrary,
        canonicalRoot,
        'cache-key-A',
        'Library',
      );
      expect(second).not.toBeNull();
      expect(fs.existsSync(first!.canonicalPath)).toBe(true);

      fs.rmSync(runnerLibrary, { recursive: true, force: true });
    });
  });

  describe('preparedOverlay and swapPreparedOverlay', () => {
    it('builds a prepared overlay and atomic-renames it into place', async () => {
      if (!CanonicalCacheService.isCapable(canonicalRoot)) return;

      const runnerLibrary = fs.mkdtempSync(path.join(SUITE_TMP, 'runner-'));
      makeFileTree(runnerLibrary, {
        'ScriptAssemblies/Game.dll': 'compiled',
      });
      await CanonicalCacheService.publishCanonical(
        runnerLibrary,
        canonicalRoot,
        'cache-key-prepared',
        'Library',
      );

      const overlayPath = fs.mkdtempSync(path.join(SUITE_TMP, 'overlay-'));
      fs.rmSync(overlayPath, { recursive: true, force: true });

      const prepared = await CanonicalCacheService.preparedOverlay(
        canonicalRoot,
        'cache-key-prepared',
        'Library',
        overlayPath,
      );
      expect(prepared).not.toBeNull();
      expect(fs.existsSync(prepared!.preparedPath)).toBe(true);
      expect(fs.existsSync(overlayPath)).toBe(false);

      const swapped = CanonicalCacheService.swapPreparedOverlay(overlayPath);
      expect(swapped).toBe(true);
      expect(fs.existsSync(overlayPath)).toBe(true);
      expect(fs.existsSync(prepared!.preparedPath)).toBe(false);

      fs.rmSync(runnerLibrary, { recursive: true, force: true });
      fs.rmSync(overlayPath, { recursive: true, force: true });
    });

    it('returns false from swapPreparedOverlay when no prepared overlay exists', () => {
      const overlayPath = path.join(SUITE_TMP, 'no-prepared-overlay');
      const result = CanonicalCacheService.swapPreparedOverlay(overlayPath);
      expect(result).toBe(false);
    });
  });

  describe('verifySentinel', () => {
    it('passes when no sentinel file is present (defense-in-depth not enabled)', () => {
      const overlayPath = fs.mkdtempSync(path.join(SUITE_TMP, 'overlay-'));
      const result = CanonicalCacheService.verifySentinel(overlayPath, 'expected');
      expect(result).toBe(true);
      fs.rmSync(overlayPath, { recursive: true, force: true });
    });

    it('passes when the sentinel matches expected content', () => {
      const overlayPath = fs.mkdtempSync(path.join(SUITE_TMP, 'overlay-'));
      fs.writeFileSync(path.join(overlayPath, '.canonical-cache-sentinel'), 'canary-value');
      const result = CanonicalCacheService.verifySentinel(overlayPath, 'canary-value');
      expect(result).toBe(true);
      fs.rmSync(overlayPath, { recursive: true, force: true });
    });

    it('fails when the sentinel is present but content differs', () => {
      const overlayPath = fs.mkdtempSync(path.join(SUITE_TMP, 'overlay-'));
      fs.writeFileSync(path.join(overlayPath, '.canonical-cache-sentinel'), 'wrong-value');
      const result = CanonicalCacheService.verifySentinel(overlayPath, 'expected-value');
      expect(result).toBe(false);
      fs.rmSync(overlayPath, { recursive: true, force: true });
    });
  });

  describe('readOverlaySha and readCanonicalSha', () => {
    it('returns the SHA from .cache_complete when present', () => {
      const overlayPath = fs.mkdtempSync(path.join(SUITE_TMP, 'overlay-'));
      fs.writeFileSync(path.join(overlayPath, '.cache_complete'), 'abc123def456');
      const result = CanonicalCacheService.readOverlaySha(overlayPath);
      expect(result).toBe('abc123def456');
      fs.rmSync(overlayPath, { recursive: true, force: true });
    });

    it('returns null when the marker is absent', () => {
      const overlayPath = fs.mkdtempSync(path.join(SUITE_TMP, 'overlay-'));
      const result = CanonicalCacheService.readOverlaySha(overlayPath);
      expect(result).toBeNull();
      fs.rmSync(overlayPath, { recursive: true, force: true });
    });
  });

  describe('classifier glob matching (via strategyFor exposed through behaviour)', () => {
    it('matches PackageCache/<name> against PackageCache/* pattern', async () => {
      if (!CanonicalCacheService.isCapable(canonicalRoot)) return;

      const runnerLibrary = fs.mkdtempSync(path.join(SUITE_TMP, 'runner-'));
      // Create a structure that exercises classifier rules.
      makeFileTree(runnerLibrary, {
        'PackageCache/com.unity.test@1.0/asset.json': '{"id": 1}',
        'ScriptAssemblies/A.dll': 'a',
      });

      const result = await CanonicalCacheService.publishCanonical(
        runnerLibrary,
        canonicalRoot,
        'glob-test',
        'Library',
      );

      expect(result).not.toBeNull();
      // The PackageCache subtree should be reachable via the canonical path.
      const publishedAsset = path.join(
        result!.canonicalPath,
        'PackageCache',
        'com.unity.test@1.0',
        'asset.json',
      );
      expect(fs.existsSync(publishedAsset)).toBe(true);

      fs.rmSync(runnerLibrary, { recursive: true, force: true });
    });
  });
});
