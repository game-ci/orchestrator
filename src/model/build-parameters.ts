/**
 * Bridge file — stub for BuildParameters.
 *
 * In unity-builder this is a 488-line god object that mixes local-build and
 * orchestrator concerns.  For the standalone orchestrator repo we only need
 * the shape consumed by orchestrator code (providers, services, options, tests).
 *
 * During Phase 3 of the extraction plan this will be replaced by a proper
 * lean interface supplied by the host (unity-builder or CLI).
 */

import * as core from '@actions/core';
import { Cli } from './cli/cli';
import Input from './input';

class BuildParameters {
  // ── identity ────────────────────────────────────────────────────────
  editorVersion!: string;
  customImage!: string;
  unitySerial!: string;
  unityLicensingServer!: string;
  skipActivation!: string;
  runnerTempPath!: string;
  targetPlatform!: string;
  projectPath!: string;
  buildProfile!: string;
  buildName!: string;
  buildPath!: string;
  buildFile!: string;
  buildMethod!: string;
  buildVersion!: string;
  androidVersionCode!: string;

  // ── flags ───────────────────────────────────────────────────────────
  manualExit!: boolean;
  enableGpu!: boolean;
  isCliMode!: boolean;
  allowDirtyBuild!: boolean;
  cacheUnityInstallationOnMac!: boolean;

  // ── orchestrator ────────────────────────────────────────────────────
  providerStrategy!: string;
  maxRetainedWorkspaces!: number;
  useLargePackages!: boolean;
  useCompressionStrategy!: boolean;
  garbageMaxAge!: number;
  githubChecks!: boolean;
  asyncWorkflow!: boolean;
  githubCheckId!: string;
  finalHooks!: string[];
  skipLfs!: boolean;
  skipCache!: boolean;
  lockedWorkspace!: string;

  // ── docker ──────────────────────────────────────────────────────────
  dockerWorkspacePath!: string;
  dockerCpuLimit!: string;
  dockerMemoryLimit!: string;
  dockerIsolationMode!: string;

  // ── networking / auth ───────────────────────────────────────────────
  gitPrivateToken!: string;
  sshAgent!: string;
  sshPublicKeysDirectoryPath!: string;
  chownFilesTo!: string;

  // ── cloud ───────────────────────────────────────────────────────────
  kubeConfig!: string;
  kubeVolumeSize!: string;
  kubeVolume!: string;
  kubeStorageClass!: string;
  containerMemory!: string;
  containerCpu!: string;
  readTimeout!: number;
  awsStackName!: string;
  awsBaseStackName!: string;
  awsUseSpot!: boolean;
  awsSpotFallback!: boolean;
  awsUseEphemeralStorage!: boolean;
  awsEphemeralStorageSize!: number;
  cloudRunnerCluster!: string;
  cloudRunnerCpu!: string;
  cloudRunnerMemory!: string;

  // ── storage ───────────────────────────────────────────────────────────
  storageProvider!: string;
  rcloneRemote!: string;

  // ── caching / workspace isolation ───────────────────────────────────
  localCacheEnabled!: boolean;
  localCacheLibrary!: boolean;
  localCacheLfs!: boolean;
  childWorkspacesEnabled!: boolean;
  childWorkspaceName!: string;
  childWorkspaceCacheRoot!: string;
  childWorkspacePreserveGit!: boolean;
  childWorkspaceSeparateLibrary!: boolean;

  // ── hooks ───────────────────────────────────────────────────────────
  gitHooksEnabled!: boolean;
  gitHooksSkipList!: string;

  // ── hot runner ──────────────────────────────────────────────────────
  hotRunnerEnabled!: boolean;
  hotRunnerTransport!: string;
  hotRunnerHost!: string;
  hotRunnerPort!: number;
  hotRunnerHealthInterval!: number;
  hotRunnerMaxIdle!: number;
  hotRunnerFallbackToCold!: boolean;

  // ── sync ────────────────────────────────────────────────────────────
  syncStrategy!: string;
  syncStatePath!: string;
  syncInputRef!: string;
  syncStorageRemote!: string;
  syncRevertAfter!: boolean;

  // ── reliability ─────────────────────────────────────────────────────
  gitIntegrityCheck!: boolean;
  gitAutoRecover!: boolean;
  cleanReservedFilenames!: boolean;
  buildArchiveEnabled!: boolean;
  buildArchivePath!: string;
  buildArchiveRetention!: number;
  buildGuid!: string;
  branch!: string;
  gitSha!: string;

  // ── submodule / lfs ─────────────────────────────────────────────────
  submoduleProfilePath!: string;
  submoduleVariantPath!: string;
  submoduleToken!: string;
  lfsTransferAgent!: string;
  lfsTransferAgentArgs!: string;
  lfsStoragePaths!: string;

  // ── test workflow ───────────────────────────────────────────────────
  testSuitePath!: string;

  // ── artifact / output ───────────────────────────────────────────────
  artifactCustomTypes!: string;
  artifactOutputTypes!: string;
  artifactUploadTarget!: string;
  artifactUploadPath!: string;
  artifactCompression!: string;
  artifactRetentionDays!: number;

  // ── middleware ───────────────────────────────────────────────────────
  middlewarePipeline!: string;

  // ── provider-specific fields ────────────────────────────────────────
  remotePowershellHost!: string;
  remotePowershellTransport!: string;
  remotePowershellCredential!: string;
  githubActionsRepo!: string;
  githubActionsWorkflow!: string;
  githubActionsToken!: string;
  githubActionsRef!: string;
  gitlabProjectId!: string;
  gitlabTriggerToken!: string;
  gitlabApiUrl!: string;
  gitlabRef!: string;
  ansibleInventory!: string;
  ansiblePlaybook!: string;
  ansibleExtraVars!: string;
  ansibleVaultPassword!: string;

  // ── catch-all for any additional properties ─────────────────────────
  [key: string]: any;

  /**
   * Factory — builds a BuildParameters instance from action inputs or CLI options.
   *
   * TODO(extraction): During Phase 3, the host will supply a pre-built config
   * object rather than reading inputs directly.
   */
  static async create(): Promise<BuildParameters> {
    const p = new BuildParameters();

    // Minimal stub: populate from Input (which reads core.getInput / Cli.query)
    p.editorVersion = Input.editorVersion || '2021.3.0f1';
    p.targetPlatform = Input.targetPlatform || 'StandaloneLinux64';
    p.projectPath = Input.projectPath || '.';
    p.buildName = Input.buildName || p.targetPlatform;
    p.buildPath = Input.buildsPath || './build';
    p.buildFile = '';
    p.buildMethod = '';
    p.buildVersion = '1.0.0';
    p.androidVersionCode = '';
    p.customImage = Input.customImage || '';
    p.unitySerial = '';
    p.unityLicensingServer = '';
    p.skipActivation = '';
    p.runnerTempPath = process.env.RUNNER_TEMP || '';
    p.manualExit = Input.manualExit;
    p.enableGpu = Input.enableGpu;
    p.isCliMode = Cli.isCliMode;
    p.allowDirtyBuild = Input.allowDirtyBuild;

    // Orchestrator fields
    p.providerStrategy = Input.getInput('providerStrategy') || process.env.PROVIDER_STRATEGY || 'local';
    p.maxRetainedWorkspaces = Number(Input.getInput('maxRetainedWorkspaces')) || 0;
    p.githubChecks = false;
    p.asyncWorkflow = false;
    p.githubCheckId = '';
    p.finalHooks = [];
    p.skipLfs = false;
    p.skipCache = false;
    p.lockedWorkspace = '';
    p.awsStackName = Input.getInput('awsStackName') || process.env.AWS_STACK_NAME || 'game-ci';
    p.storageProvider = Input.getInput('storageProvider') || process.env.STORAGE_PROVIDER || 's3';
    p.rcloneRemote = Input.getInput('rcloneRemote') || process.env.RCLONE_REMOTE || '';
    p.awsUseSpot = Input.getInput('awsUseSpot') === 'true';
    p.awsSpotFallback = Input.getInput('awsSpotFallback') !== 'false';
    p.awsUseEphemeralStorage = Input.getInput('awsUseEphemeralStorage') === 'true';
    p.awsEphemeralStorageSize = Number(Input.getInput('awsEphemeralStorageSize')) || 25;
    p.dockerWorkspacePath = Input.dockerWorkspacePath || '/github/workspace';
    p.dockerCpuLimit = '';
    p.dockerMemoryLimit = '';
    p.dockerIsolationMode = '';
    p.gitPrivateToken = '';
    p.buildGuid = '';
    p.branch = '';
    p.gitSha = '';
    p.customJob = '';
    p.preBuildContainerHooks = '';
    p.postBuildContainerHooks = '';
    p.commandHooks = '';

    // Pass through any CLI overrides not explicitly handled above
    if (Cli.options) {
      for (const [key, value] of Object.entries(Cli.options)) {
        if (value !== undefined && !(key in p && p[key] !== undefined)) {
          p[key] = value;
        }
      }
    }

    return p;
  }

  static shouldUseRetainedWorkspaceMode(buildParameters: BuildParameters): boolean {
    return (
      buildParameters.maxRetainedWorkspaces > 0 && buildParameters.lockedWorkspace !== ''
    );
  }

  static parseBuildFile(filename: string, _platform: string, _androidExportType: string): string {
    return filename;
  }

  static getSerialFromLicenseFile(_license: string): string {
    return '';
  }
}

export default BuildParameters;
export { BuildParameters };
