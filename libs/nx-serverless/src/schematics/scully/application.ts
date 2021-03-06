import {
  apply,
  chain,
  mergeWith,
  move,
  Rule,
  SchematicContext,
  template,
  Tree,
  url,
  externalSchematic,
  noop
} from '@angular-devkit/schematics';
import { join, normalize } from '@angular-devkit/core';
import { Schema } from './schema';
import { updateWorkspaceInTree, getProjectConfig } from '@nrwl/workspace';
import { offsetFromRoot } from '@nrwl/workspace';
import init from '../init/init';
import { getBuildConfig } from '../utils';

interface NormalizedSchema extends Schema {}

function getServeConfig(options: NormalizedSchema) {
  return {
    builder: '@flowaccount/nx-serverless:offline',
    options: {
      waitUntilTargets: [options.project + ':scully'],
      buildTarget: options.project + ':compile',
      config: join(options.appProjectRoot, 'serverless.yml'),
      location: join(normalize('dist'), options.appProjectRoot)
    },
    configurations: {
      dev: {
        buildTarget: options.project + ':compile:dev'
      },
      production: {
        buildTarget: options.project + ':compile:production'
      }
    }
  };
}

function getScullyBuilderConfig(options: NormalizedSchema) {
  return {
    builder: '@flowaccount/nx-serverless:scully',
    options: {
      buildTarget: options.project + ':build:production',
      configFiles: [join(options.appProjectRoot, 'scully.config.js')],
      scanRoutes: true,
      removeStaticDist: true,
      skipBuild: false
    }
  };
}

function getDeployConfig(options: NormalizedSchema) {
  return {
    builder: '@flowaccount/nx-serverless:deploy',
    options: {
      waitUntilTargets: [options.project + ':scully'],
      buildTarget: options.project + ':compile:production',
      config: join(options.appProjectRoot, 'serverless.yml'),
      location: join(normalize('dist'), options.appProjectRoot),
      package: join(normalize('dist'), options.appProjectRoot)
    }
  };
}

function getDestroyConfig(options: NormalizedSchema) {
  return {
    builder: '@flowaccount/nx-serverless:destroy',
    options: {
      buildTarget: options.project + ':compile:production',
      config: join(options.appProjectRoot, 'serverless.yml'),
      location: join(normalize('dist'), options.appProjectRoot),
      package: join(normalize('dist'), options.appProjectRoot)
    }
  };
}

function updateWorkspaceJson(options: NormalizedSchema): Rule {
  return updateWorkspaceInTree(workspaceJson => {
    const project = workspaceJson.projects[options.project];
    const buildConfig = getBuildConfig(options);
    buildConfig.options['skipClean'] = true;
    buildConfig.options['outputPath'] = normalize('dist');
    buildConfig.options['tsConfig'] = join(
      options.appProjectRoot,
      'tsconfig.serverless.json'
    );
    buildConfig.builder = '@flowaccount/nx-serverless:compile';
    project.architect.compile = buildConfig;
    project.architect.scully = getScullyBuilderConfig(options);
    project.architect.offline = getServeConfig(options);
    project.architect.deploy = getDeployConfig(options);
    project.architect.destroy = getDestroyConfig(options);
    workspaceJson.projects[options.project] = project;
    return workspaceJson;
  });
}

function addAppFiles(options: NormalizedSchema): Rule {
  return mergeWith(
    apply(url('./files/app'), [
      template({
        tmpl: '',
        name: options.project,
        root: options.appProjectRoot,
        offset: offsetFromRoot(options.appProjectRoot)
      }),
      move(options.appProjectRoot)
    ])
  );
}

function addServerlessYMLFile(options: NormalizedSchema): Rule {
  return (host: Tree) => {
    host.create(
      join(options.appProjectRoot, 'serverless.yml'),
      `service: ${options.project}
frameworkVersion: ">=1.1.0 <2.0.0"
plugins:
  - serverless-offline
  - serverless-apigw-binary
package:
  individually: true
  excludeDevDependencies: false
  # path: ${join(normalize('dist'), options.appProjectRoot)}
  custom:
    enable_optimize:
      local: false
provider:
  name: ${options.provider}
  region: ${options.region}
  endpointType: ${options.endpointType}
  runtime: nodejs10.x
  memorySize: 192
  timeout: 10
custom:
  apigwBinary:
    types:
      - '*/*'
functions:
  web-app:
    handler: handler.webApp
    events:
      - http: ANY {proxy+}
      - http: ANY /
      `
    );
  };
}

function normalizeOptions(project: any, options: Schema): NormalizedSchema {
  return {
    ...options,
    appProjectRoot: project.root
  };
}

export default function(schema: Schema): Rule {
  return (host: Tree, context: SchematicContext) => {
    const project = getProjectConfig(host, schema.project);
    const options = normalizeOptions(project, schema);
    return chain([
      init({
        skipFormat: options.skipFormat,
        expressProxy: true
      }),
      // options.addScully
      //   ? externalSchematic('@scullyio/scully', 'run', {

      //     })
      //   : noop(),
      addAppFiles(options),
      addServerlessYMLFile(options),
      updateWorkspaceJson(options)
    ])(host, context);
  };
}
