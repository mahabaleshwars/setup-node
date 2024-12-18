import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import {ExecOutput} from '@actions/exec';

import fs from 'fs';
import path from 'path';

const TIMEOUT_DURATION = 30000;

export function getNodeVersionFromFile(versionFilePath: string): string | null {
  if (!fs.existsSync(versionFilePath)) {
    throw new Error(
      `The specified node version file at: ${versionFilePath} does not exist`
    );
  }

  const contents = fs.readFileSync(versionFilePath, 'utf8');

  // Try parsing the file as an NPM `package.json` file.
  try {
    const manifest = JSON.parse(contents);

    // Presume package.json file.
    if (typeof manifest === 'object' && !!manifest) {
      // Support Volta.
      // See https://docs.volta.sh/guide/understanding#managing-your-project
      if (manifest.volta?.node) {
        return manifest.volta.node;
      }

      if (manifest.engines?.node) {
        return manifest.engines.node;
      }

      // Support Volta workspaces.
      // See https://docs.volta.sh/advanced/workspaces
      if (manifest.volta?.extends) {
        const extendedFilePath = path.resolve(
          path.dirname(versionFilePath),
          manifest.volta.extends
        );
        core.info('Resolving node version from ' + extendedFilePath);
        return getNodeVersionFromFile(extendedFilePath);
      }

      // If contents are an object, we parsed JSON
      // this can happen if node-version-file is a package.json
      // yet contains no volta.node or engines.node
      //
      // If node-version file is _not_ JSON, control flow
      // will not have reached these lines.
      //
      // And because we've reached here, we know the contents
      // *are* JSON, so no further string parsing makes sense.
      return null;
    }
  } catch {
    core.info('Node version file is not JSON file');
  }

  const found = contents.match(/^(?:node(js)?\s+)?v?(?<version>[^\s]+)$/m);
  return found?.groups?.version ?? contents.trim();
}

export async function printEnvDetailsAndSetOutput() {
  core.startGroup('Environment details');
  const promises = ['node', 'npm', 'yarn'].map(async tool => {
    const pathTool = await io.which(tool, false);
    const output = pathTool ? await getToolVersion(tool, ['--version']) : '';

    return {tool, output};
  });

  const tools = await Promise.all(promises);
  tools.forEach(({tool, output}) => {
    if (tool === 'node') {
      core.setOutput(`${tool}-version`, output);
    }
    core.info(`${tool}: ${output}`);
  });

  core.endGroup();
}

async function getToolVersion(
  tool: string,
  options: string[]
): Promise<string> {
  try {
    // Create a timeout promise that rejects after the defined duration
    const timeoutPromise = new Promise<ExecOutput>((_, reject) =>
      setTimeout(
        () =>
          reject(new Error(`Command timed out after ${TIMEOUT_DURATION}ms`)),
        TIMEOUT_DURATION
      )
    );

    // Execute the command and race it with the timeout
    const execOutput: ExecOutput = await Promise.race([
      exec.getExecOutput(tool, options, {
        ignoreReturnCode: true,
        silent: true
      }),
      timeoutPromise
    ]);

    // Now that we know the result is an ExecOutput, we can safely access stdout, stderr, and exitCode
    if (execOutput.exitCode > 0) {
      core.info(`[warning]${execOutput.stderr}`);
      return '';
    }

    return execOutput.stdout.trim();
  } catch (err) {
    if (err instanceof Error && err.message.includes('timed out')) {
      core.error(
        `Command timed out after ${TIMEOUT_DURATION}ms: ${tool} ${options.join(
          ' '
        )}`
      );
    } else if (err instanceof Error) {
      core.error(`Error executing command: ${err.message}`);
    } else {
      core.error(
        `Unknown error executing command: ${tool} ${options.join(' ')}`
      );
    }
    return '';
  }
}

export const unique = () => {
  const encountered = new Set();
  return (value: unknown): boolean => {
    if (encountered.has(value)) return false;
    encountered.add(value);
    return true;
  };
};
