import BuildParameters from '../../../build-parameters';
import OrchestratorEnvironmentVariable from '../../options/orchestrator-environment-variable';
import OrchestratorLogger from '../../services/core/orchestrator-logger';
import { ProviderInterface } from '../provider-interface';
import OrchestratorSecret from '../../options/orchestrator-secret';
import Docker from '../../../docker';
import { Action } from '../../..';
import { writeFileSync } from 'node:fs';
import Orchestrator from '../../orchestrator';
import { ProviderResource } from '../provider-resource';
import { ProviderWorkflow } from '../provider-workflow';
import { OrchestratorSystem } from '../../services/core/orchestrator-system';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CommandHookService } from '../../services/hooks/command-hook-service';
import { StringKeyValuePair } from '../../../shared-types';

class LocalDockerOrchestrator implements ProviderInterface {
  public buildParameters!: BuildParameters;

  listResources(): Promise<ProviderResource[]> {
    return new Promise((resolve) => resolve([]));
  }
  listWorkflow(): Promise<ProviderWorkflow[]> {
    throw new Error('Method not implemented.');
  }
  watchWorkflow(): Promise<string> {
    throw new Error('Method not implemented.');
  }
  async garbageCollect(
    filter: string,
    previewOnly: boolean,
    olderThan: number,
    fullCache: boolean,
    // eslint-disable-next-line no-unused-vars
    baseDependencies: boolean,
  ): Promise<string> {
    const maxAgeHours = Number(olderThan) || 24;
    const output: string[] = [];

    // Clean up stopped game-ci containers older than maxAge
    const containerFilter = filter || 'unity';
    const listCmd = `docker ps -a --filter "status=exited" --filter "name=${containerFilter}" --format "{{.ID}}\\t{{.Names}}\\t{{.CreatedAt}}"`;

    try {
      const containerList = await OrchestratorSystem.Run(listCmd, false, true);
      for (const line of containerList.split('\n')) {
        if (!line.trim()) continue;
        const [id, name, ...createdParts] = line.split('\t');
        if (!id) continue;
        const createdAt = new Date(createdParts.join('\t'));
        const ageMs = Date.now() - createdAt.getTime();
        if (ageMs < maxAgeHours * 60 * 60 * 1000) continue;

        if (previewOnly) {
          OrchestratorLogger.log(`[dry-run] Would remove container ${name} (${id})`);
          output.push(`[dry-run] Would remove container: ${name}`);
        } else {
          OrchestratorLogger.log(`Removing container ${name} (${id})`);
          await OrchestratorSystem.Run(`docker rm ${id}`, false, true);
          output.push(`Removed container: ${name}`);
        }
      }
    } catch (error) {
      OrchestratorLogger.log(`Failed to list/remove containers: ${error}`);
    }

    // Clean up dangling images (and optionally all game-ci images if fullCache)
    try {
      if (fullCache) {
        const imageList = await OrchestratorSystem.Run(
          `docker images --filter "reference=*unity*" --format "{{.ID}}\\t{{.Repository}}:{{.Tag}}\\t{{.CreatedAt}}"`,
          false,
          true,
        );
        for (const line of imageList.split('\n')) {
          if (!line.trim()) continue;
          const [id, repo, ...createdParts] = line.split('\t');
          if (!id) continue;
          const createdAt = new Date(createdParts.join('\t'));
          const ageMs = Date.now() - createdAt.getTime();
          if (ageMs < maxAgeHours * 60 * 60 * 1000) continue;

          if (previewOnly) {
            OrchestratorLogger.log(`[dry-run] Would remove image ${repo} (${id})`);
            output.push(`[dry-run] Would remove image: ${repo}`);
          } else {
            OrchestratorLogger.log(`Removing image ${repo} (${id})`);
            await OrchestratorSystem.Run(`docker rmi ${id}`, false, true);
            output.push(`Removed image: ${repo}`);
          }
        }
      } else {
        // Just prune dangling images
        if (previewOnly) {
          const pruneOutput = await OrchestratorSystem.Run(
            `docker image prune --force --filter "until=${maxAgeHours}h" --dry-run 2>/dev/null || docker images -f "dangling=true" -q`,
            false,
            true,
          );
          if (pruneOutput.trim()) {
            output.push(`[dry-run] Would prune dangling images`);
          }
        } else {
          const pruneOutput = await OrchestratorSystem.Run(
            `docker image prune --force --filter "until=${maxAgeHours}h"`,
            false,
            true,
          );
          if (pruneOutput.trim()) {
            output.push(`Pruned dangling images`);
          }
        }
      }
    } catch (error) {
      OrchestratorLogger.log(`Failed to clean up images: ${error}`);
    }

    // Clean up build cache volumes
    try {
      const volumeList = await OrchestratorSystem.Run(
        `docker volume ls --filter "name=orchestrator" --format "{{.Name}}"`,
        false,
        true,
      );
      for (const volumeName of volumeList.split('\n')) {
        if (!volumeName.trim()) continue;
        if (previewOnly) {
          OrchestratorLogger.log(`[dry-run] Would remove volume ${volumeName}`);
          output.push(`[dry-run] Would remove volume: ${volumeName}`);
        } else {
          OrchestratorLogger.log(`Removing volume ${volumeName}`);
          await OrchestratorSystem.Run(`docker volume rm ${volumeName}`, false, true);
          output.push(`Removed volume: ${volumeName}`);
        }
      }
    } catch (error) {
      OrchestratorLogger.log(`Failed to clean up volumes: ${error}`);
    }

    if (output.length === 0) {
      output.push('No resources matched garbage collection criteria');
    }

    return output.join('\n');
  }
  async cleanupWorkflow(
    buildParameters: BuildParameters,
    // eslint-disable-next-line no-unused-vars
    branchName: string,
    // eslint-disable-next-line no-unused-vars
    defaultSecretsArray: {
      ParameterKey: string;
      EnvironmentVariable: string;
      ParameterValue: string;
    }[],
  ) {
    const { workspace } = Action;
    if (
      fs.existsSync(
        `${workspace}/orchestrator-cache/cache/build/build-${buildParameters.buildGuid}.tar${
          Orchestrator.buildParameters.useCompressionStrategy ? '.lz4' : ''
        }`,
      )
    ) {
      await OrchestratorSystem.Run(`ls ${workspace}/orchestrator-cache/cache/build/`);
      await OrchestratorSystem.Run(
        `rm -r ${workspace}/orchestrator-cache/cache/build/build-${buildParameters.buildGuid}.tar${
          Orchestrator.buildParameters.useCompressionStrategy ? '.lz4' : ''
        }`,
      );
    }
  }
  setupWorkflow(
    buildGuid: string,
    buildParameters: BuildParameters,
    // eslint-disable-next-line no-unused-vars
    branchName: string,
    // eslint-disable-next-line no-unused-vars
    defaultSecretsArray: {
      ParameterKey: string;
      EnvironmentVariable: string;
      ParameterValue: string;
    }[],
  ) {
    this.buildParameters = buildParameters;
  }

  public async runTaskInWorkflow(
    buildGuid: string,
    image: string,
    commands: string,
    mountdir: string,
    workingdir: string,
    environment: OrchestratorEnvironmentVariable[],
    secrets: OrchestratorSecret[],
  ): Promise<string> {
    OrchestratorLogger.log(buildGuid);
    OrchestratorLogger.log(commands);

    const { workspace, actionFolder } = Action;
    const content: StringKeyValuePair[] = [];
    for (const x of secrets) {
      content.push({ name: x.EnvironmentVariable, value: x.ParameterValue });
    }

    // Replace localhost with host.docker.internal for local AWS emulator endpoints (similar to K8s)
    // This allows Docker containers to access the emulator (e.g. MiniStack) running on the host
    const endpointEnvironmentNames = new Set([
      'AWS_S3_ENDPOINT',
      'AWS_ENDPOINT',
      'AWS_CLOUD_FORMATION_ENDPOINT',
      'AWS_ECS_ENDPOINT',
      'AWS_KINESIS_ENDPOINT',
      'AWS_CLOUD_WATCH_LOGS_ENDPOINT',
      'INPUT_AWSS3ENDPOINT',
      'INPUT_AWSENDPOINT',
    ]);
    for (const x of environment) {
      let value = x.value;
      if (
        typeof value === 'string' &&
        endpointEnvironmentNames.has(x.name) &&
        (value.startsWith('http://localhost') || value.startsWith('http://127.0.0.1'))
      ) {
        // Replace localhost with host.docker.internal so containers can access host services
        value = value
          .replace('http://localhost', 'http://host.docker.internal')
          .replace('http://127.0.0.1', 'http://host.docker.internal');
        OrchestratorLogger.log(
          `Replaced localhost with host.docker.internal for ${x.name}: ${value}`,
        );
      }
      content.push({ name: x.name, value });
    }

    // if (this.buildParameters?.orchestratorIntegrationTests) {
    //   core.info(JSON.stringify(content, undefined, 4));
    //   core.info(JSON.stringify(secrets, undefined, 4));
    //   core.info(JSON.stringify(environment, undefined, 4));
    // }

    // eslint-disable-next-line unicorn/no-for-loop
    for (let index = 0; index < content.length; index++) {
      if (content[index] === undefined) {
        delete content[index];
      }
    }
    let myOutput = '';
    const sharedFolder = `/data/`;

    // core.info(JSON.stringify({ workspace, actionFolder, ...this.buildParameters, ...content }, undefined, 4));
    const entrypointFilePath = `start.sh`;

    // Use #!/bin/sh for POSIX compatibility (Alpine-based images like rclone/rclone don't have bash)
    const fileContents = `#!/bin/sh
set -e

mkdir -p /github/workspace/orchestrator-cache
mkdir -p /data/cache
cp -a /github/workspace/orchestrator-cache/. ${sharedFolder}
${CommandHookService.ApplyHooksToCommands(commands, this.buildParameters)}
# Only copy cache directory, exclude retained workspaces to avoid running out of disk space
if [ -d "${sharedFolder}cache" ]; then
  cp -a ${sharedFolder}cache/. /github/workspace/orchestrator-cache/cache/ || true
fi
# Copy test files from /data/ root to workspace for test assertions
# This allows tests to write files to /data/ and have them available in the workspace
find ${sharedFolder} -maxdepth 1 -type f -name "test-*" -exec cp -a {} /github/workspace/orchestrator-cache/ \\; || true
`;
    writeFileSync(`${workspace}/${entrypointFilePath}`, fileContents, {
      flag: 'w',
    });

    // Write injected config files to workspace so they're available inside the container
    if (
      Orchestrator.buildParameters.configFiles &&
      Object.keys(Orchestrator.buildParameters.configFiles).length > 0
    ) {
      const configDir = path.join(workspace, 'game-ci-config');
      fs.mkdirSync(configDir, { recursive: true });
      for (const [filename, fileContent] of Object.entries(
        Orchestrator.buildParameters.configFiles,
      )) {
        const filePath = path.join(configDir, filename);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, fileContent);
      }
      OrchestratorLogger.log(
        `Injected ${Object.keys(Orchestrator.buildParameters.configFiles).length} config files into ${configDir}`,
      );
    }

    if (Orchestrator.buildParameters.orchestratorDebug) {
      OrchestratorLogger.log(`Running local-docker: \n ${fileContents}`);
    }

    if (fs.existsSync(`${workspace}/orchestrator-cache`)) {
      await OrchestratorSystem.Run(
        `ls ${workspace}/orchestrator-cache && du -sh ${workspace}/orchestrator-cache`,
      );
    }
    const exitCode = await Docker.run(
      image,
      { workspace, actionFolder, ...this.buildParameters },
      false,
      `chmod +x /github/workspace/${entrypointFilePath} && /github/workspace/${entrypointFilePath}`,
      content,
      {
        listeners: {
          stdout: (data: Buffer) => {
            myOutput += data.toString();
          },
          stderr: (data: Buffer) => {
            myOutput += `[LOCAL-DOCKER-ERROR]${data.toString()}`;
          },
        },
      },
      true,
    );

    // Docker doesn't exit on fail now so adding this to ensure behavior is unchanged
    // TODO: Is there a helpful way to consume the exit code or is it best to except
    if (exitCode !== 0) {
      throw new Error(`Build failed with exit code ${exitCode}`);
    }

    return myOutput;
  }
}
export default LocalDockerOrchestrator;
