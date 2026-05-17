import path from 'node:path';
import OrchestratorOptions from './orchestrator-options';
import Orchestrator from '../orchestrator';
import BuildParameters from '../../build-parameters';
import { getEngine } from '../../engine';

export class OrchestratorFolders {
  public static readonly repositoryFolder = 'repo';

  public static ToLinuxFolder(folder: string) {
    return folder.replace(/\\/g, `/`);
  }

  // Only the following paths that do not start a path.join with another "Full" suffixed property need to start with an absolute /

  public static get uniqueOrchestratorJobFolderAbsolute(): string {
    return Orchestrator.buildParameters &&
      BuildParameters.shouldUseRetainedWorkspaceMode(Orchestrator.buildParameters)
      ? path.join(`/`, OrchestratorFolders.buildVolumeFolder, Orchestrator.lockedWorkspace)
      : path.join(
          `/`,
          OrchestratorFolders.buildVolumeFolder,
          Orchestrator.buildParameters.buildGuid,
        );
  }

  public static get cacheFolderForAllFull(): string {
    return path.join('/', OrchestratorFolders.buildVolumeFolder, OrchestratorFolders.cacheFolder);
  }

  public static get cacheFolderForCacheKeyFull(): string {
    return path.join(
      '/',
      OrchestratorFolders.buildVolumeFolder,
      OrchestratorFolders.cacheFolder,
      Orchestrator.buildParameters.cacheKey,
    );
  }

  public static get builderPathAbsolute(): string {
    return path.join(
      OrchestratorOptions.useSharedBuilder
        ? `/${OrchestratorFolders.buildVolumeFolder}`
        : OrchestratorFolders.uniqueOrchestratorJobFolderAbsolute,
      `builder`,
    );
  }

  public static get repoPathAbsolute(): string {
    return path.join(
      OrchestratorFolders.uniqueOrchestratorJobFolderAbsolute,
      OrchestratorFolders.repositoryFolder,
    );
  }

  public static get projectPathAbsolute(): string {
    return path.join(
      OrchestratorFolders.repoPathAbsolute,
      Orchestrator.buildParameters.projectPath,
    );
  }

  public static engineCacheFolderAbsolute(folder: string): string {
    return path.join(OrchestratorFolders.projectPathAbsolute, folder);
  }

  /** @deprecated Use engineCacheFolderAbsolute(folder) — kept for backward compatibility */
  public static get libraryFolderAbsolute(): string {
    return OrchestratorFolders.engineCacheFolderAbsolute(getEngine().cacheFolders[0] || 'Library');
  }

  public static get projectBuildFolderAbsolute(): string {
    return path.join(OrchestratorFolders.repoPathAbsolute, Orchestrator.buildParameters.buildPath);
  }

  public static get lfsFolderAbsolute(): string {
    return path.join(OrchestratorFolders.repoPathAbsolute, `.git`, `lfs`);
  }

  public static get purgeRemoteCaching(): boolean {
    return process.env.PURGE_REMOTE_BUILDER_CACHE !== undefined;
  }

  public static get lfsCacheFolderFull() {
    return path.join(OrchestratorFolders.cacheFolderForCacheKeyFull, `lfs`);
  }

  public static engineCacheFolderFull(folder: string) {
    return path.join(OrchestratorFolders.cacheFolderForCacheKeyFull, folder);
  }

  /** @deprecated Use engineCacheFolderFull(folder) — kept for backward compatibility */
  public static get libraryCacheFolderFull() {
    return OrchestratorFolders.engineCacheFolderFull(getEngine().cacheFolders[0] || 'Library');
  }

  /**
   * Whether to use http.extraHeader for git authentication (secure, default)
   * instead of embedding the token in clone URLs (legacy).
   */
  public static get useHeaderAuth(): boolean {
    return Orchestrator.buildParameters.gitAuthMode !== 'url';
  }

  public static get unityBuilderRepoUrl(): string {
    if (OrchestratorFolders.useHeaderAuth) {
      return `https://github.com/${Orchestrator.buildParameters.orchestratorRepoName}.git`;
    }

    return `https://${Orchestrator.buildParameters.gitPrivateToken}@github.com/${Orchestrator.buildParameters.orchestratorRepoName}.git`;
  }

  public static get targetBuildRepoUrl(): string {
    if (OrchestratorFolders.useHeaderAuth) {
      return `https://github.com/${Orchestrator.buildParameters.githubRepo}.git`;
    }

    return `https://${Orchestrator.buildParameters.gitPrivateToken}@github.com/${Orchestrator.buildParameters.githubRepo}.git`;
  }

  /**
   * Shell commands to configure git authentication via http.extraHeader.
   * Uses GIT_PRIVATE_TOKEN env var so the token never appears in clone URLs or git config output.
   * This is the same mechanism used by actions/checkout.
   *
   * Only emits commands when gitAuthMode is 'header' (default). In 'url' mode,
   * returns a no-op comment since the token is already in the URL.
   */
  /**
   * Shell script to clone the orchestrator/builder repo with multi-branch
   * fallback and credential recovery. Used by both build-automation and
   * async workflows.
   */
  public static cloneBuilderScript(dest: string): string {
    const repoName = Orchestrator.buildParameters.orchestratorRepoName;
    // Clean $CLONE_DEST before every clone attempt. The if/elif/else chain
    // below can leave $CLONE_DEST partially populated if an earlier clone
    // started but did not complete (network blip, broken pipe, auth probe
    // race against `git ls-remote --heads ... 2>/dev/null`). A subsequent
    // clone variant against the now-non-empty directory fails with:
    //   fatal: destination path '...' already exists and is not an empty
    //   directory.
    // `rm -rf ... 2>/dev/null || true` is idempotent on a fresh dir and
    // safe to invoke repeatedly. Confirmed failure mode in downstream
    // run 25998432649 (frostebite/GameClient, 2026-05-17): 6.5-minute
    // container lifetime spent in the retry loop before the final clone
    // fatalled on the partial-populate from earlier attempts.
    return `BRANCH="${Orchestrator.buildParameters.orchestratorBranch}"
REPO="${OrchestratorFolders.unityBuilderRepoUrl}"
REPO_PLAIN="https://github.com/${repoName}.git"
CLONE_DEST="${dest}"
_clean_clone_dest() { rm -rf "$CLONE_DEST" 2>/dev/null || true; mkdir -p "$CLONE_DEST" 2>/dev/null || true; }
if [ -n "$(git ls-remote --heads "$REPO" "$BRANCH" 2>/dev/null)" ]; then
  _clean_clone_dest
  git clone -q -b "$BRANCH" "$REPO" "$CLONE_DEST"
elif _clean_clone_dest && git clone -q -b main "$REPO" "$CLONE_DEST" 2>/dev/null; then
  echo "Cloned default branch from $REPO"
else
  echo "Authenticated clone failed; retrying without credentials"
  git config --global --unset-all http.https://github.com/.extraHeader 2>/dev/null || true
  ( _clean_clone_dest && git clone -q -b "$BRANCH" "$REPO_PLAIN" "$CLONE_DEST" 2>/dev/null ) \\
    || ( _clean_clone_dest && git clone -q -b main "$REPO_PLAIN" "$CLONE_DEST" 2>/dev/null ) \\
    || ( _clean_clone_dest && git clone -q "$REPO_PLAIN" "$CLONE_DEST" )
fi`;
  }

  public static get gitAuthConfigScript(): string {
    if (!OrchestratorFolders.useHeaderAuth) {
      return `# git auth: using token-in-URL mode (legacy)`;
    }

    return `# git auth: configuring http.extraHeader (secure mode)
if [ -n "$GIT_PRIVATE_TOKEN" ]; then
  git config --global http.https://github.com/.extraHeader "Authorization: Basic $(printf '%s' "x-access-token:$GIT_PRIVATE_TOKEN" | base64 -w 0)"
fi`;
  }

  /**
   * Configure git authentication via http.extraHeader in the current Node process.
   * For use in the remote-client where shell scripts aren't used.
   * Only configures when gitAuthMode is 'header' (default).
   */
  public static async configureGitAuth(): Promise<void> {
    if (!OrchestratorFolders.useHeaderAuth) return;

    const token =
      Orchestrator.buildParameters.gitPrivateToken || process.env.GIT_PRIVATE_TOKEN || '';
    if (!token) return;

    const encoded = Buffer.from(`x-access-token:${token}`).toString('base64');
    const { OrchestratorSystem } = await import('../services/core/orchestrator-system');
    await OrchestratorSystem.Run(
      `git config --global http.https://github.com/.extraHeader "Authorization: Basic ${encoded}"`,
    );
  }

  public static get buildVolumeFolder() {
    return 'data';
  }

  public static get cacheFolder() {
    return 'cache';
  }
}
