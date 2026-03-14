/**
 * @game-ci/orchestrator — entry point
 *
 * Exports the Orchestrator.run() function and supporting types so that
 * unity-builder (or any host) can plug it in:
 *
 *   import { Orchestrator } from '@game-ci/orchestrator';
 *   await Orchestrator.run(buildParameters, baseImage);
 */

export type {
  OrchestratorConfig,
  InputProvider,
  CIFeedbackProvider,
  ContainerRunner,
  CliContext,
  RuntimeEnvironment,
  OrchestratorResult,
  OrchestratorRunFn,
} from './model/orchestrator/interfaces';
export { default as Orchestrator } from './model/orchestrator/orchestrator';
export { default as loadProvider } from './model/orchestrator/providers/provider-loader';
export { ProviderLoader } from './model/orchestrator/providers/provider-loader';
export { BuildParameters } from './model/build-parameters';
export { GitHub } from './model/github';
export { Input } from './model/input';
export { Cli } from './model/cli/cli';
export { Docker } from './model/docker';
export { ImageTag } from './model/image-tag';
export { Action } from './model/action';
export { Platform } from './model/platform';
export { StringKeyValuePair, DockerParameters } from './model/shared-types';

// Engine plugin system
export type { EnginePlugin } from './model/engine';
export { getEngine, setEngine, initEngine, UnityPlugin } from './model/engine';
export { loadEngineFromModule, loadEngineFromCli, loadEngineFromDocker } from './model/engine';

// Re-export services for direct access
export { BuildReliabilityService } from './model/orchestrator/services/reliability';
export { TestWorkflowService } from './model/orchestrator/services/test-workflow';
export { HotRunnerService } from './model/orchestrator/services/hot-runner';
export { OutputService } from './model/orchestrator/services/output/output-service';
export { OutputTypeRegistry } from './model/orchestrator/services/output/output-type-registry';
export { ArtifactUploadHandler } from './model/orchestrator/services/output/artifact-upload-handler';
export { IncrementalSyncService } from './model/orchestrator/services/sync';

// Advanced services (lazy-loaded by unity-builder plugin interface)
export { ChildWorkspaceService } from './model/orchestrator/services/cache/child-workspace-service';
export { LocalCacheService } from './model/orchestrator/services/cache/local-cache-service';
export { SubmoduleProfileService } from './model/orchestrator/services/submodule/submodule-profile-service';
export { LfsAgentService } from './model/orchestrator/services/lfs/lfs-agent-service';
export { GitHooksService } from './model/orchestrator/services/hooks/git-hooks-service';
