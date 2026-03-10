# @game-ci/orchestrator

Standalone orchestrator for game-ci, handling remote build orchestration across AWS, Kubernetes, Docker, GitHub Actions, GitLab CI, Ansible, and Remote PowerShell providers. This package provides a unified interface for dispatching and managing CI/CD build jobs across multiple infrastructure backends, with built-in support for enterprise-grade reliability, caching, and artifact management.

## Quick Start

Install the package:

```bash
yarn add @game-ci/orchestrator
```

Basic usage:

```typescript
import { Orchestrator } from '@game-ci/orchestrator';

await Orchestrator.run(buildParameters, baseImage);
```

## Providers

- **AWS ECS** -- Run builds on Amazon ECS Fargate or EC2 tasks
- **Kubernetes** -- Schedule builds as Kubernetes Jobs
- **Docker** -- Execute builds in local or remote Docker containers
- **GitHub Actions** -- Dispatch builds to GitHub Actions workflows
- **GitLab CI** -- Trigger builds on GitLab CI pipelines
- **Ansible** -- Orchestrate builds via Ansible playbooks
- **Remote PowerShell** -- Run builds on remote Windows machines via PowerShell
- **CLI** -- Local command-line interface for development and testing

## Enterprise Services

- **Build Reliability** -- Automatic retries, health checks, and failure recovery
- **Test Workflows** -- Structured test execution and reporting
- **Hot Runner** -- Keep build environments warm for faster iteration
- **Incremental Sync** -- Sync only changed files to reduce transfer time
- **LFS Agent** -- Efficient Git LFS handling for large assets
- **Submodule Profiles** -- Configurable submodule checkout strategies
- **Child Workspaces** -- Nested workspace support for monorepos
- **Local Cache** -- Local caching layer for dependencies and intermediate artifacts
- **Output/Artifact Management** -- Collect, store, and distribute build outputs

## Development

```bash
yarn install
yarn test
yarn build
```

## Note

This package was extracted from [game-ci/unity-builder](https://github.com/game-ci/unity-builder). See PR #819 for the extraction plan.

## License

MIT
