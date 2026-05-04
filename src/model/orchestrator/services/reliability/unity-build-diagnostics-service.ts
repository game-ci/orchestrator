import fs from "node:fs";
import path from "node:path";

export type UnityRecoveryAction =
  | "success"
  | "fail"
  | "retry-licensing"
  | "retry-lfs-pull"
  | "retry-package-cache"
  | "retry-api-updater"
  | "retry-two-phase-import"
  | "reset-source-asset-db"
  | "nuke-library";

export interface UnityRunDiagnosticInput {
  exitCode: number;
  runtimeSeconds?: number;
  logText?: string;
  projectPath?: string;
  buildMethodPattern?: RegExp;
  artifactDbMtimeBeforeMs?: number;
}

export interface UnityRunDiagnostics {
  exitCode: number;
  runtimeSeconds: number;
  buildMethodInvoked: boolean;
  crashEvidenceFound: boolean;
  lfsPointerDllFound: boolean;
  licensingFailure: boolean;
  guidErrors: boolean;
  packageCacheCorrupt: boolean;
  apiUpdaterRan: boolean;
  importCompleted: boolean;
  silentSuccess: boolean;
  preserveLibrary: boolean;
  nukeLibrary: boolean;
  recommendedAction: UnityRecoveryAction;
  matchedPatterns: string[];
}

export class UnityBuildDiagnosticsService {
  static readonly CRASH_EVIDENCE_PATTERNS = [
    /ErrorInvalidPPtrCast/i,
    /Segmentation fault/i,
    /SIGSEGV/i,
    /AccessViolationException/i,
    /Fatal error in Unity CIL/i,
    /Crash!!!/i,
    /Fatal Error!/i,
    /A crash has been intercepted/i,
    /EditorUtility.*:.*NullRef/i,
    /AssetDatabase.*corruption/i,
    /Native Crash Reporting/i,
    /Build asset version error/i,
    /Unity\.ILPP\.Runner.*(CLR exception|0xe0434352)/i,
  ];

  private static readonly LFS_POINTER_HEADER =
    "version https://git-lfs.github.com/spec/v1";

  static analyzeRun(input: UnityRunDiagnosticInput): UnityRunDiagnostics {
    const logText = input.logText || "";
    const normalizedExitCode = UnityBuildDiagnosticsService.normalizeExitCode(
      input.exitCode
    );
    const matchedPatterns =
      UnityBuildDiagnosticsService.matchCrashEvidence(logText);
    const buildMethodInvoked =
      UnityBuildDiagnosticsService.detectBuildMethodInvoked(
        logText,
        input.buildMethodPattern
      );
    const lfsPointerDllFound = input.projectPath
      ? UnityBuildDiagnosticsService.scanForLfsPointerDlls(input.projectPath)
          .length > 0
      : false;
    const diagnostics: UnityRunDiagnostics = {
      exitCode: normalizedExitCode,
      runtimeSeconds: input.runtimeSeconds ?? 0,
      buildMethodInvoked,
      crashEvidenceFound: matchedPatterns.length > 0,
      lfsPointerDllFound,
      licensingFailure:
        /Access token is unavailable|No valid license|license\.ulicx file not found/i.test(
          logText
        ),
      guidErrors:
        /error CS0246:.*Library[\\/]+PackageCache|Library[\\/]+PackageCache.*error CS0246/i.test(
          logText
        ),
      packageCacheCorrupt: /Could not restore immutable package asset/i.test(
        logText
      ),
      apiUpdaterRan: /APIUpdater|AssemblyUpdater|Running API updater/i.test(
        logText
      ),
      importCompleted: UnityBuildDiagnosticsService.detectImportCompleted(
        input.projectPath,
        input.artifactDbMtimeBeforeMs,
        logText
      ),
      silentSuccess: normalizedExitCode === 0 && !buildMethodInvoked,
      preserveLibrary: true,
      nukeLibrary: false,
      recommendedAction: "fail",
      matchedPatterns,
    };

    const action =
      UnityBuildDiagnosticsService.recommendRecoveryAction(diagnostics);
    diagnostics.recommendedAction = action;
    diagnostics.nukeLibrary = action === "nuke-library";
    diagnostics.preserveLibrary = !diagnostics.nukeLibrary;

    return diagnostics;
  }

  static normalizeExitCode(exitCode: number): number {
    if (exitCode === 4294967295) return -1;
    if (exitCode === 3221225477) return -1073741819;

    return exitCode;
  }

  static matchCrashEvidence(logText: string): string[] {
    const matches: string[] = [];

    for (const pattern of UnityBuildDiagnosticsService.CRASH_EVIDENCE_PATTERNS) {
      if (pattern.test(logText)) {
        matches.push(pattern.source);
      }
    }

    return matches;
  }

  static recommendRecoveryAction(
    diagnostics: UnityRunDiagnostics
  ): UnityRecoveryAction {
    if (diagnostics.lfsPointerDllFound) return "retry-lfs-pull";

    if (
      diagnostics.exitCode === -1 &&
      diagnostics.runtimeSeconds > 0 &&
      diagnostics.runtimeSeconds < 60 &&
      diagnostics.licensingFailure
    ) {
      return "retry-licensing";
    }

    if (diagnostics.silentSuccess) return "reset-source-asset-db";
    if (diagnostics.apiUpdaterRan) return "retry-api-updater";
    if (diagnostics.packageCacheCorrupt || diagnostics.guidErrors)
      return "retry-package-cache";

    if (
      diagnostics.exitCode !== 0 &&
      diagnostics.crashEvidenceFound &&
      !diagnostics.importCompleted
    ) {
      return "retry-two-phase-import";
    }

    if (
      diagnostics.exitCode !== 0 &&
      diagnostics.crashEvidenceFound &&
      diagnostics.importCompleted
    ) {
      return "nuke-library";
    }

    if (diagnostics.exitCode === 0) return "success";

    return "fail";
  }

  static scanForLfsPointerDlls(projectPath: string, maxBytes = 200): string[] {
    const matches: string[] = [];
    const roots = ["Assets", "Packages"]
      .map((root) => path.join(projectPath, root))
      .filter((root) => fs.existsSync(root));

    const scan = (directory: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath);
          continue;
        }

        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".dll")) {
          continue;
        }

        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > maxBytes) continue;

          const content = fs.readFileSync(fullPath, "utf8");
          if (
            content.startsWith(UnityBuildDiagnosticsService.LFS_POINTER_HEADER)
          ) {
            matches.push(fullPath);
          }
        } catch {
          // Binary or inaccessible files are not LFS pointer stubs.
        }
      }
    };

    for (const root of roots) {
      scan(root);
    }

    return matches;
  }

  private static detectBuildMethodInvoked(
    logText: string,
    buildMethodPattern?: RegExp
  ): boolean {
    if (buildMethodPattern) {
      return buildMethodPattern.test(logText);
    }

    return /BuildMethodInvoked\s*[:=]\s*True|Executing method|executeMethod/i.test(
      logText
    );
  }

  private static detectImportCompleted(
    projectPath?: string,
    artifactDbMtimeBeforeMs?: number,
    logText?: string
  ): boolean {
    if (
      /AssetDatabase.*Refresh.*completed|InitialRefresh.*completed|Refresh completed/i.test(
        logText || ""
      )
    ) {
      return true;
    }

    if (!projectPath) {
      return false;
    }

    const artifactDb = path.join(projectPath, "Library", "ArtifactDB");
    try {
      if (!fs.existsSync(artifactDb)) {
        return false;
      }

      if (artifactDbMtimeBeforeMs === undefined) {
        return fs.statSync(artifactDb).size > 0;
      }

      return fs.statSync(artifactDb).mtimeMs > artifactDbMtimeBeforeMs;
    } catch {
      return false;
    }
  }
}
