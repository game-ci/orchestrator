/**
 * Registers all orchestrator-specific options with the CLI's yargs instance.
 *
 * These options are provider-specific (aws, k8s, gcp, azure, hooks, etc.) and
 * are owned by the orchestrator plugin, not the CLI core.
 */
export function configureOrchestratorOptions(yargs: any): void {
  // --- Provider / execution ---
  yargs.option('region', {
    description: 'Cloud provider region',
    type: 'string',
    default: 'eu-west-2',
  })

  yargs.option('buildPlatform', {
    description: 'Build platform (linux, win32, darwin)',
    type: 'string',
  })

  yargs.option('fallbackProviderStrategy', {
    description: 'Fallback provider if primary fails',
    type: 'string',
    default: '',
  })

  yargs.option('providerInitTimeout', {
    description: 'Timeout (ms) for provider initialization',
    type: 'number',
    default: 0,
  })

  yargs.option('gitAuthMode', {
    description: 'Git auth mode (header, ssh)',
    type: 'string',
    default: 'header',
  })

  // --- Runner checks ---
  yargs.option('runnerCheckEnabled', {
    description: 'Enable runner availability checks before dispatching',
    type: 'boolean',
    default: false,
  })

  yargs.option('runnerCheckLabels', {
    description: 'Comma-separated runner labels to check',
    type: 'string',
    default: '',
  })

  yargs.option('runnerCheckMinAvailable', {
    description: 'Minimum available runners required',
    type: 'number',
    default: 1,
  })

  yargs.option('retryOnFallback', {
    description: 'Retry with fallback provider on failure',
    type: 'boolean',
    default: false,
  })

  // --- Container resources ---
  yargs.option('containerCpu', {
    description: 'Container CPU units (1024 = 1 vCPU)',
    type: 'string',
    default: '1024',
  })

  yargs.option('containerMemory', {
    description: 'Container memory in MB',
    type: 'string',
    default: '3072',
  })

  yargs.option('containerNamespace', {
    description: 'Container/Kubernetes namespace',
    type: 'string',
    default: 'default',
  })

  // --- AWS ---
  yargs.option('awsStackName', {
    description: 'AWS CloudFormation stack name',
    type: 'string',
    default: 'game-ci',
  })

  yargs.option('awsBaseStackName', {
    description: 'AWS base stack name (defaults to awsStackName)',
    type: 'string',
  })

  yargs.option('awsUseSpot', {
    description: 'Use AWS Spot instances',
    type: 'boolean',
    default: false,
  })

  yargs.option('awsSpotFallback', {
    description: 'Fall back to on-demand if spot unavailable',
    type: 'boolean',
    default: true,
  })

  yargs.option('awsUseEphemeralStorage', {
    description: 'Use ephemeral storage for ECS tasks',
    type: 'boolean',
    default: false,
  })

  yargs.option('awsEphemeralStorageSize', {
    description: 'Ephemeral storage size in GB',
    type: 'number',
    default: 25,
  })

  yargs.option('awsEndpoint', {
    description: 'AWS endpoint override (e.g., for LocalStack)',
    type: 'string',
  })

  yargs.option('awsCloudFormationEndpoint', {
    description: 'AWS CloudFormation endpoint override',
    type: 'string',
  })

  yargs.option('awsEcsEndpoint', {
    description: 'AWS ECS endpoint override',
    type: 'string',
  })

  yargs.option('awsKinesisEndpoint', {
    description: 'AWS Kinesis endpoint override',
    type: 'string',
  })

  yargs.option('awsCloudWatchLogsEndpoint', {
    description: 'AWS CloudWatch Logs endpoint override',
    type: 'string',
  })

  yargs.option('awsS3Endpoint', {
    description: 'AWS S3 endpoint override',
    type: 'string',
  })

  // --- Kubernetes ---
  yargs.option('kubeConfig', {
    description: 'Kubernetes config (base64 encoded or path)',
    type: 'string',
    default: '',
  })

  yargs.option('kubeVolume', {
    description: 'Kubernetes persistent volume name',
    type: 'string',
    default: '',
  })

  yargs.option('kubeVolumeSize', {
    description: 'Kubernetes persistent volume size',
    type: 'string',
    default: '25Gi',
  })

  yargs.option('kubeStorageClass', {
    description: 'Kubernetes storage class',
    type: 'string',
    default: '',
  })

  // --- Storage ---
  yargs.option('storageProvider', {
    description: 'Remote storage provider (s3, gcs, etc.)',
    type: 'string',
    default: 's3',
  })

  yargs.option('rcloneRemote', {
    description: 'Rclone remote name for storage',
    type: 'string',
    default: '',
  })

  // --- Hooks ---
  yargs.option('containerHookFiles', {
    description: 'Comma-separated container hook file paths',
    type: 'string',
    default: '',
  })

  yargs.option('commandHookFiles', {
    description: 'Comma-separated command hook file paths',
    type: 'string',
    default: '',
  })

  yargs.option('commandHooks', {
    description: 'YAML command hooks',
    type: 'string',
    default: '',
  })

  yargs.option('postBuildContainerHooks', {
    description: 'Post-build container hooks (YAML)',
    type: 'string',
    default: '',
  })

  yargs.option('preBuildContainerHooks', {
    description: 'Pre-build container hooks (YAML)',
    type: 'string',
    default: '',
  })

  yargs.option('finalHooks', {
    description: 'Comma-separated final hook workflows to trigger',
    type: 'string',
    default: '',
  })

  yargs.option('middlewarePipeline', {
    description: 'Middleware pipeline configuration',
    type: 'string',
    default: '',
  })

  // --- Input override ---
  yargs.option('pullInputList', {
    description: 'Comma-separated list of inputs to pull from secret manager',
    type: 'string',
    default: '',
  })

  yargs.option('secretSource', {
    description: 'Secret source identifier',
    type: 'string',
    default: '',
  })

  yargs.option('inputPullCommand', {
    description: 'Command template for pulling secrets (gcp-secret-manager, aws-secret-manager, or custom)',
    type: 'string',
    default: '',
  })

  // --- Git / orchestrator ---
  yargs.option('orchestratorBranch', {
    description: 'Orchestrator repo branch',
    type: 'string',
    default: 'main',
  })

  yargs.option('orchestratorRepoName', {
    description: 'Orchestrator GitHub repo',
    type: 'string',
    default: 'game-ci/orchestrator',
  })

  yargs.option('cloneDepth', {
    description: 'Git clone depth',
    type: 'string',
    default: '50',
  })

  // --- Caching ---
  yargs.option('cacheKey', {
    description: 'Cache key for build caching',
    type: 'string',
  })

  yargs.option('skipLfs', {
    description: 'Skip Git LFS',
    type: 'boolean',
    default: false,
  })

  yargs.option('skipCache', {
    description: 'Skip caching',
    type: 'boolean',
    default: false,
  })

  // --- Advanced ---
  yargs.option('orchestratorDebug', {
    description: 'Enable orchestrator debug logging',
    type: 'boolean',
    default: false,
  })

  yargs.option('asyncOrchestrator', {
    description: 'Enable async workflow mode',
    type: 'boolean',
    default: false,
  })

  yargs.option('resourceTracking', {
    description: 'Enable resource tracking',
    type: 'boolean',
    default: false,
  })

  yargs.option('useLargePackages', {
    description: 'Use large packages mode',
    type: 'boolean',
    default: false,
  })

  yargs.option('useCompressionStrategy', {
    description: 'Enable compression strategy',
    type: 'boolean',
    default: false,
  })

  yargs.option('maxRetainedWorkspaces', {
    description: 'Max retained workspaces for shared builds',
    type: 'string',
    default: '0',
  })

  yargs.option('garbageMaxAge', {
    description: 'Max age in hours for garbage collection',
    type: 'number',
    default: 24,
  })

  yargs.option('dryRun', {
    alias: 'dry-run',
    description: 'Preview garbage-collect actions without deleting resources (maps to previewOnly)',
    type: 'boolean',
    default: false,
  })

  // --- GitHub integration ---
  yargs.option('githubChecks', {
    description: 'Enable GitHub Checks integration',
    type: 'boolean',
    default: false,
  })

  yargs.option('githubCheckId', {
    description: 'Existing GitHub Check ID to update',
    type: 'string',
    default: '',
  })

  // --- Engine ---
  yargs.option('engine', {
    description: 'Game engine name (unity, godot, unreal, etc.)',
    type: 'string',
    default: 'unity',
  })

  yargs.option('enginePlugin', {
    description: 'Engine plugin source: module:<npm-pkg>, cli:<executable>, docker:<image>',
    type: 'string',
    default: '',
  })

  // --- Provider-specific: GCP Cloud Run ---
  yargs.option('gcpCloudRunRegion', {
    description: 'GCP Cloud Run region',
    type: 'string',
  })

  yargs.option('gcpCloudRunProject', {
    description: 'GCP project ID',
    type: 'string',
  })

  // --- Provider-specific: Azure ACI ---
  yargs.option('azureResourceGroup', {
    description: 'Azure resource group',
    type: 'string',
  })

  yargs.option('azureSubscriptionId', {
    description: 'Azure subscription ID',
    type: 'string',
  })

  // --- Provider-specific: GitHub Actions ---
  yargs.option('githubActionsRepo', {
    description: 'GitHub Actions target repository (owner/repo)',
    type: 'string',
    default: '',
  })

  yargs.option('githubActionsWorkflow', {
    description: 'GitHub Actions workflow filename',
    type: 'string',
    default: '',
  })

  yargs.option('githubActionsToken', {
    description: 'GitHub token for Actions dispatch',
    type: 'string',
    default: '',
  })

  // --- Provider-specific: GitLab CI ---
  yargs.option('gitlabProjectId', {
    description: 'GitLab project ID',
    type: 'string',
    default: '',
  })

  yargs.option('gitlabTriggerToken', {
    description: 'GitLab pipeline trigger token',
    type: 'string',
    default: '',
  })

  yargs.option('gitlabApiUrl', {
    description: 'GitLab API base URL',
    type: 'string',
    default: '',
  })

  // --- Provider-specific: Remote PowerShell ---
  yargs.option('remotePowershellHost', {
    description: 'Remote PowerShell target hostname',
    type: 'string',
    default: '',
  })

  // --- Provider-specific: Ansible ---
  yargs.option('ansibleInventory', {
    description: 'Ansible inventory path or content',
    type: 'string',
    default: '',
  })

  yargs.option('ansiblePlaybook', {
    description: 'Ansible playbook path',
    type: 'string',
    default: '',
  })

  // --- Hot runner ---
  yargs.option('hotRunnerEnabled', {
    description: 'Enable hot runner pool',
    type: 'boolean',
    default: false,
  })

  yargs.option('hotRunnerTransport', {
    description: 'Hot runner transport (tcp, websocket)',
    type: 'string',
    default: 'tcp',
  })

  // --- Sync ---
  yargs.option('syncStrategy', {
    description: 'Incremental sync strategy',
    type: 'string',
    default: '',
  })
}
