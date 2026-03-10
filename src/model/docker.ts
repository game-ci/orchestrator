/**
 * Bridge file — stub for Docker.
 *
 * The orchestrator's docker provider delegates the actual container
 * execution to this class.  In the standalone repo this is a thin stub
 * that will be replaced by a proper DockerRunner interface.
 */

import * as core from '@actions/core';
import { StringKeyValuePair } from './shared-types';

class Docker {
  static async run(
    image: string,
    parameters: { [key: string]: any },
    silent = false,
    overrideCommands = '',
    _additionalVariables: StringKeyValuePair[] = [],
    _options?: any,
    _entrypointBash = false,
  ): Promise<number> {
    if (!silent) {
      core.info(`[Docker] run: image=${image}, overrideCommands=${overrideCommands}`);
    }

    // Stub: the real implementation builds a docker run command and executes it.
    // In the standalone orchestrator this is injected by the host.
    throw new Error(
      'Docker.run is a bridge stub. The host application must supply a real Docker runner.',
    );
  }
}

export default Docker;
export { Docker };
