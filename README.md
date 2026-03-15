# @game-ci/orchestrator

Build orchestration engine for [Game CI](https://game.ci). Dispatches game engine builds to cloud infrastructure, manages their lifecycle, and streams results back to your CI pipeline or terminal.

**Engine agnostic** — Unity is built-in, with a plugin system for Godot, Unreal, and custom engines. **Infrastructure agnostic** — choose from 9 built-in providers or write your own in any language.

```mermaid
flowchart LR
  subgraph input["Input"]
    A["GitHub Actions<br/>GitLab CI<br/>CLI<br/>Any CI System"]
  end
  subgraph orchestrator["Orchestrator"]
    direction TB
    E["Engine Plugin"] --> P["Provider Selection"]
    P --> S["Services<br/>(cache, sync, hooks, output)"]
  end
  subgraph targets["Build Target"]
    C["AWS ECS Fargate<br/>Kubernetes<br/>Local Docker<br/>GCP Cloud Run<br/>Azure ACI<br/>GitHub Actions<br/>GitLab CI<br/>Custom (CLI protocol)"]
  end
  A --> E
  S --> C
  C -- "artifacts + logs" --> A
```

## Features

**Engine & Provider Agnosticism**
- **Engine agnostic** — Unity built-in, with a [plugin system](#engine-agnosticism) for Godot, Unreal, and custom engines
- **Multi-provider** — AWS Fargate, Kubernetes, GCP Cloud Run, Azure ACI, GitHub Actions, GitLab CI, Ansible, Remote PowerShell, local Docker
- **Custom providers** — write your own provider in any language via the [CLI provider protocol](#custom-providers-via-cli-protocol)

**Build Orchestration**
- **CLI** — `game-ci build`, `game-ci orchestrate`, `game-ci status` from your terminal
- **GitHub Actions integration** — use as a step in any workflow via [game-ci/unity-builder](https://github.com/game-ci/unity-builder)
- **Container hooks** — composable pre/post-build scripts (S3 upload, Steam deploy, rclone sync)
- **Middleware pipeline** — trigger-aware composable hooks with phase, provider, and platform filters

**Performance & Reliability**
- **Caching** — engine-aware asset caching, retained workspaces, local cache layer
- **Incremental sync** — transfer only changed files to build containers
- **Hot runner** — keep build environments warm for sub-minute iteration
- **Build reliability** — automatic retries, health checks, provider fallback, failure recovery

**Outputs & Observability**
- **Test workflows** — structured test execution with result parsing and reporting
- **LFS support** — efficient Git LFS handling for large assets
- **Artifact management** — collect, upload, and distribute build outputs
- **Log streaming** — real-time build logs via Kinesis (AWS) or pod logs (K8s)

## Install

### Quick Install (Linux / macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/game-ci/orchestrator/main/install.sh | sh
```

### Quick Install (Windows PowerShell)

```powershell
irm https://raw.githubusercontent.com/game-ci/orchestrator/main/install.ps1 | iex
```

### Options

| Environment variable | Description |
| --- | --- |
| `GAME_CI_VERSION` | Pin a specific release (e.g. `v2.0.0`). Defaults to latest. |
| `GAME_CI_INSTALL` | Override install directory. Defaults to `~/.game-ci/bin`. |

```bash
# Example: install a specific version
GAME_CI_VERSION=v2.0.0 curl -fsSL https://raw.githubusercontent.com/game-ci/orchestrator/main/install.sh | sh
```

### Manual Download

Pre-built binaries for every platform are published on the [GitHub Releases](https://github.com/game-ci/orchestrator/releases) page. Download the binary for your OS/arch, make it executable, and place it on your `PATH`.

## Quick Start

### GitHub Actions

Add to your workflow via [game-ci/unity-builder](https://github.com/game-ci/unity-builder):

```yaml
- uses: game-ci/unity-builder@v4
  with:
    providerStrategy: aws          # or k8s, local-docker, etc.
    targetPlatform: StandaloneLinux64
    gitPrivateToken: ${{ secrets.GITHUB_TOKEN }}
    containerCpu: 2048
    containerMemory: 8192
```

### CLI

```bash
game-ci build \
  --providerStrategy aws \
  --projectPath ./my-unity-project \
  --targetPlatform StandaloneLinux64

game-ci status --providerStrategy aws

game-ci orchestrate \
  --providerStrategy k8s \
  --projectPath ./my-unity-project \
  --targetPlatform StandaloneLinux64
```

## Engine Agnosticism

The orchestrator is fully engine agnostic. No game engine logic is hardcoded into the core — instead, engine-specific behavior is provided through a plugin system. Unity ships as a built-in plugin, and other engines (Godot, Unreal, custom) plug in through the same `EnginePlugin` interface.

```mermaid
flowchart TD
  subgraph plugins["Engine Plugins"]
    U["Unity (built-in)<br/>cacheFolders: Library<br/>preStop: return license"]
    G["Godot<br/>cacheFolders: .godot/imported,<br/>.godot/shader_cache"]
    R["Unreal<br/>cacheFolders: DerivedDataCache,<br/>Intermediate"]
    X["Your Engine<br/>cacheFolders: ..."]
  end
  subgraph core["Orchestrator Core"]
    C["Cache Service"]
    L["Container Lifecycle"]
    W["Build Workflow"]
    P["Provider Dispatch"]
  end
  U & G & R & X --> C & L & W
  W --> P
```

### Why Engine Agnostic?

Game CI started as a Unity-only tool. As the project grew, users wanted support for Godot, Unreal, and custom engines. Rather than hardcoding each engine, the orchestrator delegates all engine-specific behavior to plugins. The core handles what's universal — caching, container lifecycle, provider dispatch, hooks, and artifact management — while plugins supply the engine-specific details.

This means:
- **Adding a new engine** doesn't require changing the orchestrator
- **Engine-specific caching** is automatic — each plugin declares its own cache folders
- **Container lifecycle hooks** (like Unity license cleanup) are engine-configurable
- **All orchestrator services** (sync, hot runner, reliability, etc.) work with any engine

### EnginePlugin Interface

The interface is intentionally minimal — typically 3-5 lines:

```typescript
interface EnginePlugin {
  /** Engine identifier: 'unity', 'godot', 'unreal', etc. */
  name: string;

  /** Folders to cache between builds, relative to projectPath */
  cacheFolders: string[];

  /** Shell command for container shutdown — e.g. license cleanup (optional) */
  preStopCommand?: string;
}
```

| Field | Purpose | Example |
| --- | --- | --- |
| `name` | Identifies the engine throughout the orchestrator | `'godot'` |
| `cacheFolders` | Folders preserved between builds to speed up iteration | `['.godot/imported', '.godot/shader_cache']` |
| `preStopCommand` | Runs during container shutdown (e.g. Kubernetes preStop hook, 90s grace period) | `'cleanup-license.sh'` |

### How Plugins Integrate

Engine plugins feed into multiple orchestrator services:

```mermaid
flowchart LR
  EP["EnginePlugin<br/>(name, cacheFolders,<br/>preStopCommand)"]
  EP --> CS["Cache Service<br/>Save/restore engine<br/>cache folders"]
  EP --> CW["Child Workspaces<br/>Isolated builds with<br/>per-engine caching"]
  EP --> BW["Build Workflow<br/>Cache tar commands<br/>per folder"]
  EP --> K8["K8s Job Spec<br/>preStop lifecycle<br/>hook"]
```

- **Cache Service** — iterates `cacheFolders` to save/restore between builds
- **Child Workspaces** — creates isolated workspaces with engine-specific caches
- **Build Workflow** — generates cache initialization commands for each folder
- **Kubernetes preStop** — executes `preStopCommand` during pod shutdown (90s grace period)

### Built-in: Unity

Unity ships as the default plugin. No configuration needed:

```typescript
// Built into the orchestrator
const UnityPlugin: EnginePlugin = {
  name: 'unity',
  cacheFolders: ['Library'],
  preStopCommand: 'return_license.sh',
};
```

```bash
# Unity is the default — just build
game-ci build --targetPlatform StandaloneLinux64
```

### Using Other Engines

Specify `--engine` and `--engine-plugin` to use a non-Unity engine:

```yaml
# GitHub Actions
- uses: game-ci/unity-builder@v4
  with:
    engine: godot
    enginePlugin: '@game-ci/godot-engine'
    targetPlatform: StandaloneLinux64
```

```bash
# CLI
game-ci build \
  --engine godot \
  --engine-plugin @game-ci/godot-engine \
  --target-platform linux
```

### Plugin Sources

Plugins can be loaded from three sources, so you can write them in any language:

```mermaid
flowchart LR
  subgraph sources["Plugin Sources"]
    direction TB
    NPM["NPM Module<br/>TypeScript / JavaScript"]
    CLI["CLI Executable<br/>Any language"]
    DOC["Docker Image<br/>Any language"]
  end
  subgraph loader["Engine Loader"]
    L["initEngine()"]
  end
  NPM -- "require()" --> L
  CLI -- "spawn + JSON stdout" --> L
  DOC -- "docker run + JSON stdout" --> L
  L --> EP["Active EnginePlugin"]
```

| Source | Format | Example |
| --- | --- | --- |
| NPM module | Package name or local path | `@game-ci/godot-engine`, `./my-plugin.js` |
| CLI executable | `cli:<path>` | `cli:/usr/local/bin/my-engine-plugin` |
| Docker image | `docker:<image>` | `docker:gameci/godot-engine-plugin` |

### Writing a Plugin

**NPM module** (TypeScript/JavaScript) — export an `EnginePlugin` object:

```typescript
// index.ts
export default {
  name: 'godot',
  cacheFolders: ['.godot/imported', '.godot/shader_cache'],
};
```

**CLI executable** (any language) — print JSON on stdout when called with `get-engine-config`:

```bash
#!/bin/bash
echo '{"name":"godot","cacheFolders":[".godot/imported",".godot/shader_cache"]}'
```

```python
#!/usr/bin/env python3
import json, sys
if sys.argv[1] == "get-engine-config":
    json.dump({"name": "godot", "cacheFolders": [".godot/imported"]}, sys.stdout)
```

**Docker image** — `docker run --rm <image> get-engine-config` must print JSON config:

```dockerfile
FROM alpine
COPY engine-config.sh /usr/local/bin/
ENTRYPOINT ["engine-config.sh"]
```

See the [Engine Plugins documentation](https://game.ci/docs/github-orchestrator/advanced-topics/engine-plugins) for the full guide.

## Providers

| Provider | Strategy flag | Description |
| --- | --- | --- |
| AWS ECS Fargate | `aws` | Serverless containers on AWS. Auto-provisions CloudFormation stacks, S3, Kinesis log streaming. |
| Kubernetes | `k8s` | Schedules builds as K8s Jobs with persistent volumes. Works with any cluster. |
| GCP Cloud Run | `gcp-cloud-run` | Serverless containers on Google Cloud. |
| Azure ACI | `azure-aci` | Azure Container Instances. |
| Local Docker | `local-docker` | Run builds in Docker on the current machine. No cloud account needed. |
| GitHub Actions | `github-actions` | Dispatch builds to GitHub Actions workflows. |
| GitLab CI | `gitlab-ci` | Trigger builds on GitLab CI pipelines. |
| Ansible | `ansible` | Orchestrate builds via Ansible playbooks. |
| Remote PowerShell | `remote-powershell` | Run builds on remote Windows machines. |
| **Custom (CLI protocol)** | &mdash; | Write your own provider in any language. See below. |

All providers implement the same `ProviderInterface`, which the orchestrator calls at each phase of the build lifecycle. This means every provider gets the same capabilities — caching, hooks, middleware, artifact management — for free.

### Custom Providers via CLI Protocol

Write providers in **any language** — Go, Python, Rust, shell, or anything that reads stdin and writes stdout. The orchestrator communicates with your executable via JSON over stdin/stdout:

```mermaid
flowchart LR
  subgraph orch["Orchestrator"]
    O["Spawns your binary<br/>per subcommand"]
  end
  subgraph exec["Your Executable"]
    E["setup-workflow<br/>run-task<br/>cleanup-workflow<br/>garbage-collect<br/>list-resources"]
  end
  O -- "argv[1] + JSON stdin" --> E
  E -- "JSON stdout" --> O
  E -. "stderr → log" .-> O
```

Point `providerExecutable` at your binary:

```yaml
- uses: game-ci/unity-builder@v4
  with:
    providerExecutable: ./my-provider
    targetPlatform: StandaloneLinux64
```

Or from the CLI:

```bash
game-ci build \
  --providerExecutable ./my-provider \
  --projectPath ./my-unity-project \
  --targetPlatform StandaloneLinux64
```

Your executable receives a subcommand as `argv[1]` (`setup-workflow`, `run-task`, `cleanup-workflow`, etc.) and a JSON payload on stdin. Respond with JSON on stdout. Log to stderr.

See the [CLI Provider Protocol docs](https://game.ci/docs/github-orchestrator/providers/cli-provider-protocol) for the full specification and a working example.

## How It Works

```mermaid
flowchart TD
  A["Input Parsing<br/>GitHub Actions / CLI / env"] --> B["Engine Plugin<br/>Resolve cache folders & hooks"]
  B --> C["Provider Selection<br/>providerStrategy → backend"]
  C --> D["Resource Provisioning<br/>CloudFormation / K8s Jobs / Docker"]
  D --> E["Build Execution<br/>Launch container with project"]
  E --> F["Hook Execution<br/>pre/post-build hooks & middleware"]
  F --> G["Log Streaming<br/>Real-time output"]
  G --> H["Result Collection<br/>Artifacts, test results"]
  H --> I["Cleanup<br/>Tear down or retain workspace"]
```

### Services

The orchestrator provides composable services that work with any engine and any provider:

| Service | Description |
| --- | --- |
| **Cache** | Engine-aware asset caching with local cache layer and retained workspaces |
| **Hooks** | Container hooks (pre/post-build), command hooks, and trigger-aware middleware pipeline |
| **Sync** | Incremental file sync — transfer only changed files to build containers |
| **Hot Runner** | Keep build environments warm between builds for sub-minute iteration |
| **Reliability** | Automatic retries, health checks, git integrity verification, provider fallback |
| **Output** | Artifact collection with pluggable upload handlers |
| **Test Workflow** | Structured test execution with result parsing and reporting |
| **LFS** | Git LFS tracking, hashing, and storage path mapping |
| **Core** | Logging, resource tracking, workspace locking, log streaming |

## Project Structure

```
src/
├── cli/                    # CLI entry point and commands
│   └── commands/           #   build, orchestrate, status, activate, version, update
├── model/
│   ├── engine/             # Engine plugin system
│   │   ├── engine-plugin.ts    # EnginePlugin interface
│   │   ├── unity-plugin.ts     # Built-in Unity plugin
│   │   ├── module-engine-loader.ts  # Load plugins from NPM/local modules
│   │   ├── cli-engine-loader.ts     # Load plugins from CLI executables
│   │   └── docker-engine-loader.ts  # Load plugins from Docker images
│   ├── orchestrator/
│   │   ├── providers/      # Provider implementations
│   │   │   ├── aws/        #   ECS Fargate, CloudFormation, S3
│   │   │   ├── k8s/        #   Kubernetes Jobs, PVCs, RBAC
│   │   │   ├── docker/     #   Local Docker
│   │   │   ├── gcp-cloud-run/
│   │   │   ├── azure-aci/
│   │   │   ├── github-actions/
│   │   │   ├── gitlab-ci/
│   │   │   ├── ansible/
│   │   │   ├── remote-powershell/
│   │   │   └── cli/        #   CLI provider protocol
│   │   ├── services/       # Core services
│   │   │   ├── cache/      #   Engine-aware cache, child workspaces
│   │   │   ├── hooks/      #   Container hooks, command hooks, middleware
│   │   │   ├── hot-runner/ #   Hot runner protocol
│   │   │   ├── lfs/        #   Git LFS agent
│   │   │   ├── output/     #   Artifact management, upload handlers
│   │   │   ├── reliability/#   Build retry, health checks
│   │   │   ├── sync/       #   Incremental file sync
│   │   │   ├── test-workflow/ # Test execution and reporting
│   │   │   └── core/       #   Logging, resource tracking, workspace locking
│   │   └── workflows/      # Workflow composition
│   ├── cli/                # CLI adapter layer
│   └── input-readers/      # Input parsing (GitHub Actions, CLI, env)
└── test-utils/             # Shared test helpers
```

## Development

```bash
yarn install          # Install dependencies
yarn test             # Run tests
yarn build            # Compile TypeScript
yarn game-ci --help   # Run CLI locally
yarn format           # Format with prettier
```

Requires Node.js >= 20 and Yarn 1.x.

## Documentation

Full documentation at [game.ci/docs/github-orchestrator](https://game.ci/docs/github-orchestrator/introduction):

- [Getting Started](https://game.ci/docs/github-orchestrator/getting-started)
- [AWS Examples](https://game.ci/docs/github-orchestrator/examples/aws)
- [Kubernetes Examples](https://game.ci/docs/github-orchestrator/examples/kubernetes)
- [CLI Guide](https://game.ci/docs/github-orchestrator/cli/getting-started)
- [API Reference](https://game.ci/docs/github-orchestrator/api-reference)
- [Provider Setup Guides](https://game.ci/docs/github-orchestrator/providers/overview)
- [Engine Plugins](https://game.ci/docs/github-orchestrator/advanced-topics/engine-plugins)

## Related

- [game-ci/unity-builder](https://github.com/game-ci/unity-builder) — GitHub Action that uses this package as an optional dependency ([extraction PR #819](https://github.com/game-ci/unity-builder/pull/819))
- [game-ci/documentation](https://github.com/game-ci/documentation) — Docusaurus docs site ([docs update PR #541](https://github.com/game-ci/documentation/pull/541))

## License

MIT
