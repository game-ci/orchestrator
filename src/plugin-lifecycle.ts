/**
 * Plugin lifecycle implementation for unity-builder integration.
 *
 * This module implements the OrchestratorPlugin interface defined by
 * unity-builder. The plugin reads its OWN configuration from environment
 * variables and GitHub Actions inputs — unity-builder never proxies them.
 *
 * Usage by unity-builder:
 *   const { createPlugin } = await import('@game-ci/orchestrator');
 *   const plugin = createPlugin();
 *   await plugin.initialize(coreParams, workspace);
 */

import * as core from '@actions/core';
import path from 'node:path';
import Orchestrator from './model/orchestrator/orchestrator';
import { BuildReliabilityService } from './model/orchestrator/services/reliability';
import { TestWorkflowService } from './model/orchestrator/services/test-workflow';
import { HotRunnerService } from './model/orchestrator/services/hot-runner';
import { OutputService } from './model/orchestrator/services/output/output-service';
import { OutputTypeRegistry } from './model/orchestrator/services/output/output-type-registry';
import { ArtifactUploadHandler } from './model/orchestrator/services/output/artifact-upload-handler';
import { IncrementalSyncService } from './model/orchestrator/services/sync';

// ── Input helpers ────────────────────────────────────────────────────

function getInput(name: string): string {
  // core.getInput reads INPUT_<NAME> env vars (set by GitHub Actions or the composite action)
  const coreValue = core.getInput(name);
  if (coreValue && coreValue !== '') return coreValue;

  // Fallback to raw env vars (for CLI or manual usage)
  if (process.env[name] !== undefined) return process.env[name]!;

  // camelCase → UPPER_SNAKE_CASE fallback
  const envKey = name
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toUpperCase()
    .replace(/ /g, '_');
  if (envKey !== name && process.env[envKey] !== undefined) return process.env[envKey]!;

  return '';
}

function getBool(name: string, defaultValue = false): boolean {
  const value = getInput(name);
  if (!value) return defaultValue;

  return value === 'true';
}

function getNumber(name: string, defaultValue: number): number {
  const value = getInput(name);
  if (!value) return defaultValue;

  return Number(value) || defaultValue;
}

// ── Plugin config ────────────────────────────────────────────────────
// Lazy getters — values are read from env/inputs at access time,
// so they pick up whatever the composite action or user has set.

const config = {
  // Provider
  get providerStrategy() {
    return getInput('providerStrategy') || 'local';
  },
  get fallbackProviderStrategy() {
    return getInput('fallbackProviderStrategy');
  },
  get retryOnFallback() {
    return getBool('retryOnFallback');
  },

  // Test workflow
  get testSuitePath() {
    return getInput('testSuitePath');
  },
  get testSuiteEvent() {
    return getInput('testSuiteEvent');
  },

  // Hot runner
  get hotRunnerEnabled() {
    return getBool('hotRunnerEnabled');
  },
  get hotRunnerTransport() {
    return (getInput('hotRunnerTransport') || 'websocket') as 'websocket' | 'grpc' | 'named-pipe';
  },
  get hotRunnerHost() {
    return getInput('hotRunnerHost') || 'localhost';
  },
  get hotRunnerPort() {
    return getNumber('hotRunnerPort', 9090);
  },
  get hotRunnerHealthInterval() {
    return getNumber('hotRunnerHealthInterval', 30);
  },
  get hotRunnerMaxIdle() {
    return getNumber('hotRunnerMaxIdle', 3600);
  },
  get hotRunnerFallbackToCold() {
    return getBool('hotRunnerFallbackToCold', true);
  },

  // Git reliability
  get gitIntegrityCheck() {
    return getBool('gitIntegrityCheck');
  },
  get gitAutoRecover() {
    return getBool('gitAutoRecover');
  },
  get cleanReservedFilenames() {
    return getBool('cleanReservedFilenames');
  },

  // Build archive
  get buildArchiveEnabled() {
    return getBool('buildArchiveEnabled');
  },
  get buildArchivePath() {
    return getInput('buildArchivePath') || './build-archives';
  },
  get buildArchiveRetention() {
    return getNumber('buildArchiveRetention', 30);
  },

  // Child workspaces
  get childWorkspacesEnabled() {
    return getBool('childWorkspacesEnabled');
  },
  get childWorkspaceName() {
    return getInput('childWorkspaceName');
  },
  get childWorkspaceCacheRoot() {
    return getInput('childWorkspaceCacheRoot');
  },
  get childWorkspacePreserveGit() {
    return getBool('childWorkspacePreserveGit', true);
  },
  get childWorkspaceSeparateLibrary() {
    return getBool('childWorkspaceSeparateLibrary', true);
  },

  // Submodule profiles
  get submoduleProfilePath() {
    return getInput('submoduleProfilePath');
  },
  get submoduleVariantPath() {
    return getInput('submoduleVariantPath');
  },
  get submoduleToken() {
    return getInput('submoduleToken');
  },

  // LFS
  get lfsTransferAgent() {
    return getInput('lfsTransferAgent');
  },
  get lfsTransferAgentArgs() {
    return getInput('lfsTransferAgentArgs');
  },
  get lfsStoragePaths() {
    return getInput('lfsStoragePaths');
  },

  // Local cache
  get localCacheEnabled() {
    return getBool('localCacheEnabled');
  },
  get localCacheRoot() {
    return getInput('localCacheRoot');
  },
  get localCacheLibrary() {
    return getBool('localCacheLibrary', true);
  },
  get localCacheLfs() {
    return getBool('localCacheLfs');
  },

  // Git hooks
  get gitHooksEnabled() {
    return getBool('gitHooksEnabled');
  },
  get gitHooksSkipList() {
    return getInput('gitHooksSkipList');
  },

  // Sync
  get syncStrategy() {
    return getInput('syncStrategy') || 'full';
  },
  get syncInputRef() {
    return getInput('syncInputRef');
  },
  get syncStorageRemote() {
    return getInput('syncStorageRemote');
  },
  get syncRevertAfter() {
    return getBool('syncRevertAfter', true);
  },
  get syncStatePath() {
    return getInput('syncStatePath') || '.game-ci/sync-state.json';
  },

  // Artifacts
  get artifactOutputTypes() {
    return getInput('artifactOutputTypes') || 'build,logs,test-results';
  },
  get artifactUploadTarget() {
    return getInput('artifactUploadTarget') || 'github-artifacts';
  },
  get artifactUploadPath() {
    return getInput('artifactUploadPath');
  },
  get artifactCompression() {
    return getInput('artifactCompression') || 'gzip';
  },
  get artifactRetentionDays() {
    return getInput('artifactRetentionDays') || '30';
  },
  get artifactCustomTypes() {
    return getInput('artifactCustomTypes');
  },
};

// ── Plugin interface ─────────────────────────────────────────────────

export interface OrchestratorPlugin {
  initialize(coreParams: Record<string, any>, workspace: string): Promise<void>;
  canHandleBuild(): boolean;
  handleBuild(baseImage: string): Promise<{ exitCode: number; fallbackToLocal?: boolean }>;
  beforeLocalBuild(workspace: string): Promise<void>;
  afterLocalBuild(workspace: string, exitCode: number): Promise<void>;
  handlePostBuild(exitCode: number): Promise<void>;
}

type SyncStrategy = 'full' | 'git-delta' | 'direct-input' | 'storage-pull';

// ── Factory ──────────────────────────────────────────────────────────

export function createPlugin(): OrchestratorPlugin {
  let coreParams: Record<string, any> = {};
  let workspace = '';

  // State that needs to persist between beforeLocalBuild / afterLocalBuild
  let childWorkspaceConfig: any;
  let localCacheState: { cacheRoot: string; cacheKey: string } | undefined;

  return {
    async initialize(params, ws) {
      coreParams = params;
      workspace = ws;

      // Always configure git environment for CI reliability
      BuildReliabilityService.configureGitEnvironment();
    },

    canHandleBuild(): boolean {
      if (config.testSuitePath) return true;
      if (config.hotRunnerEnabled) return true;
      if (coreParams.providerStrategy !== 'local') return true;

      return false;
    },

    async handleBuild(baseImage: string): Promise<{ exitCode: number; fallbackToLocal?: boolean }> {
      // ── Test workflow ──────────────────────────────────────────
      if (config.testSuitePath) {
        core.info('[TestWorkflow] Test suite path detected, using test workflow engine');
        const results = await TestWorkflowService.executeTestSuite(config.testSuitePath, coreParams as any);

        let totalFailed = 0;
        for (const result of results || []) {
          totalFailed += result.failed;
        }

        if (totalFailed > 0) {
          core.setFailed(`Test workflow completed with ${totalFailed} failure(s)`);

          return { exitCode: 1 };
        }
        core.info('[TestWorkflow] All test runs passed');

        return { exitCode: 0 };
      }

      // ── Hot runner ─────────────────────────────────────────────
      if (config.hotRunnerEnabled) {
        core.info('[HotRunner] Hot runner mode enabled, attempting hot build...');
        const hotRunnerService = new HotRunnerService();

        try {
          await hotRunnerService.initialize({
            enabled: true,
            transport: config.hotRunnerTransport,
            host: config.hotRunnerHost,
            port: config.hotRunnerPort,
            healthCheckInterval: config.hotRunnerHealthInterval,
            maxIdleTime: config.hotRunnerMaxIdle,
            maxJobsBeforeRecycle: 0,
          });

          const result = await hotRunnerService.submitBuild(coreParams as any, (output: string) => {
            core.info(output);
          });

          core.info(`[HotRunner] Build completed with exit code ${result.exitCode}`);
          await hotRunnerService.shutdown();

          return { exitCode: result.exitCode };
        } catch (hotRunnerError) {
          await hotRunnerService.shutdown();

          if (config.hotRunnerFallbackToCold) {
            core.warning(
              `[HotRunner] Hot runner failed: ${(hotRunnerError as Error).message}. Falling back to cold build.`,
            );

            // If the base strategy is remote, do the remote build here
            if (coreParams.providerStrategy !== 'local') {
              const result = await Orchestrator.run(coreParams as any, baseImage);

              return { exitCode: result.BuildSucceeded ? 0 : 1 };
            }

            // Signal unity-builder to do a local build
            return { exitCode: -1, fallbackToLocal: true };
          }

          throw hotRunnerError;
        }
      }

      // ── Remote build ───────────────────────────────────────────
      const result = await Orchestrator.run(coreParams as any, baseImage);

      return { exitCode: result.BuildSucceeded ? 0 : 1 };
    },

    async beforeLocalBuild(ws: string): Promise<void> {
      // ── Git integrity checks ───────────────────────────────────
      if (config.gitIntegrityCheck) {
        core.info('Running git integrity checks...');
        const isHealthy = BuildReliabilityService.checkGitIntegrity(ws);
        BuildReliabilityService.cleanStaleLockFiles(ws);
        BuildReliabilityService.validateSubmoduleBackingStores(ws);

        if (config.cleanReservedFilenames) {
          BuildReliabilityService.cleanReservedFilenames(coreParams.projectPath);
        }

        if (!isHealthy && config.gitAutoRecover) {
          core.info('Git corruption detected, attempting automatic recovery...');
          const recovered = BuildReliabilityService.recoverCorruptedRepo(ws);
          if (!recovered) {
            core.warning('Automatic recovery failed. Build may encounter issues.');
          }
        }
      } else if (config.cleanReservedFilenames) {
        BuildReliabilityService.cleanReservedFilenames(coreParams.projectPath);
      }

      // ── Child workspace restore ────────────────────────────────
      if (config.childWorkspacesEnabled && config.childWorkspaceName) {
        const { ChildWorkspaceService } = await import('./model/orchestrator/services/cache/child-workspace-service');
        const cacheRoot =
          config.childWorkspaceCacheRoot ||
          path.join(coreParams.runnerTempPath || process.env.RUNNER_TEMP || '', 'game-ci-workspaces');

        childWorkspaceConfig = ChildWorkspaceService.buildConfig({
          childWorkspacesEnabled: config.childWorkspacesEnabled,
          childWorkspaceName: config.childWorkspaceName,
          childWorkspaceCacheRoot: cacheRoot,
          childWorkspacePreserveGit: config.childWorkspacePreserveGit,
          childWorkspaceSeparateLibrary: config.childWorkspaceSeparateLibrary,
        });

        const projectFullPath = path.join(ws, coreParams.projectPath);
        const restored = ChildWorkspaceService.initializeWorkspace(projectFullPath, childWorkspaceConfig);
        core.info(
          `Child workspace "${config.childWorkspaceName}": ${restored ? 'restored from cache' : 'starting fresh'}`,
        );

        const size = ChildWorkspaceService.getWorkspaceSize(projectFullPath);
        core.info(`Child workspace size after restore: ${size}`);
      }

      // ── Submodule profiles ─────────────────────────────────────
      if (config.submoduleProfilePath) {
        core.info('Initializing submodules from profile...');
        const { SubmoduleProfileService } = await import(
          './model/orchestrator/services/submodule/submodule-profile-service'
        );
        const plan = await SubmoduleProfileService.createInitPlan(
          config.submoduleProfilePath,
          config.submoduleVariantPath,
          ws,
        );

        if (plan) {
          await SubmoduleProfileService.execute(plan, ws, config.submoduleToken || coreParams.gitPrivateToken);
        }
      }

      // ── Custom LFS transfer agent ─────────────────────────────
      if (config.lfsTransferAgent) {
        core.info('Configuring custom LFS transfer agent...');
        const { LfsAgentService } = await import('./model/orchestrator/services/lfs/lfs-agent-service');
        await LfsAgentService.configure(
          config.lfsTransferAgent,
          config.lfsTransferAgentArgs,
          config.lfsStoragePaths ? config.lfsStoragePaths.split(';') : [],
          ws,
        );
      }

      // ── Local cache restore ────────────────────────────────────
      if (config.localCacheEnabled) {
        const { LocalCacheService } = await import('./model/orchestrator/services/cache/local-cache-service');
        const cacheRoot = LocalCacheService.resolveCacheRoot(coreParams as any) || '';
        const cacheKey =
          LocalCacheService.generateCacheKey(
            coreParams.targetPlatform,
            coreParams.editorVersion,
            coreParams.branch || '',
          ) || '';

        localCacheState = { cacheRoot, cacheKey };

        if (config.localCacheLfs) {
          await LocalCacheService.restoreLfsCache(ws, cacheRoot, cacheKey);
        }
        if (config.localCacheLibrary) {
          const projectFullPath = path.join(ws, coreParams.projectPath);
          await LocalCacheService.restoreLibraryCache(projectFullPath, cacheRoot, cacheKey);
        }
      }

      // ── Git hooks ──────────────────────────────────────────────
      if (config.gitHooksEnabled) {
        const { GitHooksService } = await import('./model/orchestrator/services/hooks/git-hooks-service');
        await GitHooksService.installHooks(ws);
        if (config.gitHooksSkipList) {
          const environment = GitHooksService.configureSkipList(config.gitHooksSkipList.split(','));
          if (environment) {
            Object.assign(process.env, environment);
          }
        }
      }

      // ── Incremental sync strategy ─────────────────────────────
      const syncStrategy = config.syncStrategy;
      if (syncStrategy !== 'full') {
        core.info(`[Sync] Applying sync strategy: ${syncStrategy}`);
        await this.applySyncStrategy(ws);
      }
    },

    async afterLocalBuild(ws: string, exitCode: number): Promise<void> {
      // ── Local cache save ───────────────────────────────────────
      if (config.localCacheEnabled && localCacheState) {
        const { LocalCacheService } = await import('./model/orchestrator/services/cache/local-cache-service');
        const { cacheRoot, cacheKey } = localCacheState;

        if (config.localCacheLibrary) {
          const projectFullPath = path.join(ws, coreParams.projectPath);
          await LocalCacheService.saveLibraryCache(projectFullPath, cacheRoot, cacheKey);
        }
        if (config.localCacheLfs) {
          await LocalCacheService.saveLfsCache(ws, cacheRoot, cacheKey);
        }
      }

      // ── Child workspace save ───────────────────────────────────
      if (childWorkspaceConfig?.enabled) {
        const { ChildWorkspaceService } = await import('./model/orchestrator/services/cache/child-workspace-service');
        const projectFullPath = path.join(ws, coreParams.projectPath);

        const preSaveSize = ChildWorkspaceService.getWorkspaceSize(projectFullPath);
        core.info(`Child workspace size before save: ${preSaveSize}`);

        ChildWorkspaceService.saveWorkspace(projectFullPath, childWorkspaceConfig);
        core.info(`Child workspace "${config.childWorkspaceName}" saved to cache`);
      }

      // ── Sync revert ────────────────────────────────────────────
      if (config.syncRevertAfter && config.syncStrategy !== 'full') {
        core.info('[Sync] Reverting overlay changes after job completion');
        try {
          await IncrementalSyncService.revertOverlays(ws, config.syncStatePath);
        } catch (revertError) {
          core.warning(`[Sync] Overlay revert failed: ${(revertError as Error).message}`);
        }
      }
    },

    async handlePostBuild(exitCode: number): Promise<void> {
      // ── Build archiving ────────────────────────────────────────
      if (config.buildArchiveEnabled && exitCode === 0) {
        core.info('Archiving build output...');
        BuildReliabilityService.archiveBuildOutput(coreParams.buildPath, config.buildArchivePath);
        BuildReliabilityService.enforceRetention(config.buildArchivePath, config.buildArchiveRetention);
      }

      // ── Artifact collection and upload ─────────────────────────
      try {
        // Register custom output types
        if (config.artifactCustomTypes) {
          try {
            const customTypes = JSON.parse(config.artifactCustomTypes);
            if (Array.isArray(customTypes)) {
              for (const ct of customTypes) {
                OutputTypeRegistry.registerType({
                  name: ct.name,
                  defaultPath: ct.defaultPath || ct.pattern || `./${ct.name}/`,
                  description: ct.description || `Custom output type: ${ct.name}`,
                  builtIn: false,
                });
              }
            }
          } catch (parseError) {
            core.warning(`Failed to parse artifactCustomTypes: ${(parseError as Error).message}`);
          }
        }

        // Collect outputs and generate manifest
        const manifestPath = path.join(coreParams.projectPath, 'output-manifest.json');
        const manifest = await OutputService.collectOutputs(
          coreParams.projectPath,
          coreParams.buildGuid,
          config.artifactOutputTypes,
          manifestPath,
        );

        core.setOutput('artifactManifestPath', manifestPath);

        if (manifest) {
          const uploadConfig = ArtifactUploadHandler.parseConfig(
            config.artifactUploadTarget,
            config.artifactUploadPath || undefined,
            config.artifactCompression,
            config.artifactRetentionDays,
          );

          if (uploadConfig) {
            const uploadResult = await ArtifactUploadHandler.uploadArtifacts(
              manifest,
              uploadConfig,
              coreParams.projectPath,
            );

            if (uploadResult && !uploadResult.success) {
              core.warning(
                `Artifact upload completed with errors: ${uploadResult.entries
                  .filter((entry: any) => !entry.success)
                  .map((entry: any) => `${entry.type}: ${entry.error}`)
                  .join('; ')}`,
              );
            }
          }
        }
      } catch (artifactError) {
        core.warning(`Artifact collection/upload failed: ${(artifactError as Error).message}`);
      }
    },

    // Internal helper — not part of the public interface
    async applySyncStrategy(ws: string): Promise<void> {
      const strategy = config.syncStrategy;
      const resolvedStrategy = IncrementalSyncService.resolveStrategy(strategy as SyncStrategy, ws, config.syncStatePath);

      if (resolvedStrategy === 'full') {
        core.info('[Sync] Resolved to full sync (no incremental state available)');

        return;
      }

      switch (resolvedStrategy) {
        case 'git-delta': {
          const targetReference = coreParams.gitSha || coreParams.branch;
          const changedFiles = await IncrementalSyncService.syncGitDelta(ws, targetReference, config.syncStatePath);
          core.info(`[Sync] Git delta sync applied: ${changedFiles} file(s) changed`);
          break;
        }
        case 'direct-input': {
          if (!config.syncInputRef) {
            throw new Error('[Sync] direct-input strategy requires syncInputRef to be set');
          }
          const overlays = await IncrementalSyncService.applyDirectInput(
            ws,
            config.syncInputRef,
            config.syncStorageRemote || undefined,
            config.syncStatePath,
          );
          core.info(`[Sync] Direct input applied: ${overlays.length} overlay(s)`);
          break;
        }
        case 'storage-pull': {
          if (!config.syncInputRef) {
            throw new Error('[Sync] storage-pull strategy requires syncInputRef to be set');
          }
          const pulledFiles = await IncrementalSyncService.syncStoragePull(ws, config.syncInputRef, {
            rcloneRemote: config.syncStorageRemote || undefined,
            syncRevertAfter: config.syncRevertAfter,
            statePath: config.syncStatePath,
          });
          core.info(`[Sync] Storage pull complete: ${pulledFiles.length} file(s)`);
          break;
        }
        default:
          core.warning(`[Sync] Unknown sync strategy: ${resolvedStrategy}`);
      }
    },
  } as OrchestratorPlugin & { applySyncStrategy(ws: string): Promise<void> };
}
