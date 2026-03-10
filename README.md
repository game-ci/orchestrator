# @game-ci/orchestrator

Build orchestration engine for [Game CI](https://game.ci). Dispatches Unity builds to cloud infrastructure (AWS, Kubernetes, GCP, Azure), manages their lifecycle, and streams results back to your CI pipeline or terminal.

```
  GitHub Actions / CLI
         │
         ▼
  ┌─────────────────┐
  │   Orchestrator   │
  │  ┌─────────────┐ │     ┌──────────────────────┐
  │  │  Provider    │─┼────►│  AWS ECS Fargate      │
  │  │  Selection   │ │     ├──────────────────────┤
  │  └─────────────┘ │     │  Kubernetes Jobs      │
  │  ┌─────────────┐ │     ├──────────────────────┤
  │  │  Hooks &     │ │     │  Local Docker         │
  │  │  Middleware  │ │     ├──────────────────────┤
  │  └─────────────┘ │     │  GCP Cloud Run        │
  │  ┌─────────────┐ │     ├──────────────────────┤
  │  │  Services    │ │     │  Azure ACI            │
  │  │  (cache,     │ │     ├──────────────────────┤
  │  │   sync,      │ │     │  GitHub Actions       │
  │  │   output)    │ │     ├──────────────────────┤
  │  └─────────────┘ │     │  GitLab CI            │
  └─────────────────┘     └──────────────────────┘
```

## Features

- **Multi-provider** — AWS Fargate, Kubernetes, GCP Cloud Run, Azure ACI, GitHub Actions dispatch, GitLab CI, Ansible, Remote PowerShell, local Docker
- **Custom providers** — write your own provider in any language via the [CLI provider protocol](#custom-providers-via-cli-protocol)
- **CLI** — `game-ci build`, `game-ci orchestrate`, `game-ci status` from your terminal
- **GitHub Actions integration** — use as a step in any workflow via [game-ci/unity-builder](https://github.com/game-ci/unity-builder)
- **Container hooks** — composable pre/post-build scripts (S3 upload, Steam deploy, rclone sync)
- **Middleware pipeline** — trigger-aware composable hooks for advanced build customization
- **Caching** — S3-backed Library caching, retained workspaces, local cache layer
- **Incremental sync** — transfer only changed files to build containers
- **Hot runner** — keep build environments warm for sub-minute iteration
- **Build reliability** — automatic retries, health checks, failure recovery
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
| **Custom (CLI protocol)** | — | Write your own provider in any language. See below. |

### Custom Providers via CLI Protocol

Write providers in **any language** — Go, Python, Rust, shell, or anything that reads stdin and writes stdout. The orchestrator communicates with your executable via JSON over stdin/stdout:

```
  Orchestrator                          Your executable
 ┌──────────────────────┐              ┌──────────────────────┐
 │ Spawns your binary   │   argv[1]   │                      │
 │ per subcommand       │────────────►│  setup-workflow      │
 │                      │  JSON stdin │  run-task            │
 │                      │────────────►│  cleanup-workflow    │
 │                      │ JSON stdout │  garbage-collect     │
 │                      │◄────────────│  list-resources      │
 └──────────────────────┘  stderr→log └──────────────────────┘
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

## Project Structure

```
src/
├── cli/                    # CLI entry point and commands
│   └── commands/           #   build, orchestrate, status, activate, version, update
├── model/
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
│   │   │   ├── cache/      #   Local cache, child workspaces
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

Requires Node.js >= 18 and Yarn 1.x.

## How It Works

1. **Input parsing** — reads build parameters from GitHub Actions inputs, CLI flags, or environment variables
2. **Provider selection** — picks the infrastructure backend based on `providerStrategy`
3. **Resource provisioning** — creates cloud resources (CloudFormation stacks, K8s Jobs, etc.)
4. **Build execution** — launches the Unity build container with the project mounted
5. **Hook execution** — runs pre/post-build container hooks (caching, artifact upload, Steam deploy)
6. **Log streaming** — streams build output back to the CI runner in real time
7. **Result collection** — gathers build results, test output, and artifacts
8. **Cleanup** — tears down ephemeral resources (or retains workspaces if configured)

## Documentation

Full documentation at [game.ci/docs/github-orchestrator](https://game.ci/docs/github-orchestrator/introduction):

- [Getting Started](https://game.ci/docs/github-orchestrator/getting-started)
- [AWS Examples](https://game.ci/docs/github-orchestrator/examples/aws)
- [Kubernetes Examples](https://game.ci/docs/github-orchestrator/examples/kubernetes)
- [CLI Guide](https://game.ci/docs/github-orchestrator/cli/getting-started)
- [API Reference](https://game.ci/docs/github-orchestrator/api-reference)
- [Provider Setup Guides](https://game.ci/docs/github-orchestrator/providers/overview)

## Related

- [game-ci/unity-builder](https://github.com/game-ci/unity-builder) — GitHub Action that uses this package as an optional dependency ([extraction PR #819](https://github.com/game-ci/unity-builder/pull/819))
- [game-ci/documentation](https://github.com/game-ci/documentation) — Docusaurus docs site ([docs update PR #541](https://github.com/game-ci/documentation/pull/541))

## License

MIT
