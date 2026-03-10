import { Cli } from '../model/cli/cli';
import GitHub from '../model/github';

/**
 * Maps CLI arguments (kebab-case flags) to the Input/OrchestratorOptions
 * interface used by the action. This bridges the gap between user-friendly
 * CLI flags and the camelCase environment/input system the orchestrator expects.
 */
export interface CliArguments {
  targetPlatform?: string;
  unityVersion?: string;
  projectPath?: string;
  buildProfile?: string;
  buildName?: string;
  buildsPath?: string;
  buildMethod?: string;
  customParameters?: string;
  versioning?: string;
  version?: string;
  customImage?: string;
  manualExit?: boolean;
  enableGpu?: boolean;

  androidVersionCode?: string;
  androidExportType?: string;
  androidKeystoreName?: string;
  androidKeystoreBase64?: string;
  androidKeystorePass?: string;
  androidKeyaliasName?: string;
  androidKeyaliasPass?: string;
  androidTargetSdkVersion?: string;
  androidSymbolType?: string;

  dockerCpuLimit?: string;
  dockerMemoryLimit?: string;
  dockerIsolationMode?: string;
  dockerWorkspacePath?: string;
  containerRegistryRepository?: string;
  containerRegistryImageVersion?: string;
  runAsHostUser?: string;
  chownFilesTo?: string;

  sshAgent?: string;
  sshPublicKeysDirectoryPath?: string;
  gitPrivateToken?: string;

  providerStrategy?: string;
  awsStackName?: string;
  kubeConfig?: string;
  kubeVolume?: string;
  kubeVolumeSize?: string;
  kubeStorageClass?: string;
  containerCpu?: string;
  containerMemory?: string;
  cacheKey?: string;
  watchToEnd?: string;
  allowDirtyBuild?: boolean;
  skipActivation?: string;
  cloneDepth?: string;

  readInputFromOverrideList?: string;
  readInputOverrideCommand?: string;
  postBuildSteps?: string;
  preBuildSteps?: string;
  customJob?: string;

  unityLicensingServer?: string;

  cacheUnityInstallationOnMac?: boolean;
  unityHubVersionOnMac?: string;

  mode?: string;

  [key: string]: unknown;
}

export function mapCliArgumentsToInput(cliArguments: CliArguments): void {
  GitHub.githubInputEnabled = false;

  const mapped: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(cliArguments)) {
    if (value !== undefined && key !== '_' && key !== '$0') {
      mapped[key] = typeof value === 'boolean' ? String(value) : value;
    }
  }

  if (!mapped['mode']) {
    mapped['mode'] = 'cli';
  }

  Cli.options = mapped;
}
