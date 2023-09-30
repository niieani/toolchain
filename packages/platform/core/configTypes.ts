import type { PartialTaskConfig } from "@moonrepo/types";
import { type WorkspaceProjectsConvention } from "@repo/cli/getProjectGlobsFromMoonConfig.js";
import type PackageJson from "@repo/schema-types/schemas/packageJson.js";

export interface DependencyDef {
  packageAlias: string;
  versionOrTag?: string;
  target?: "dependencies" | "devDependencies" | "optionalDependencies";
  skipIfExists?: boolean;
}

export interface Task {
  name: string;
  type: "test" | "build" | "publish" | "format" | "start";
  definition: PartialTaskConfig;
}

export interface FileDef {
  /**
   * should this file be ephemeral and is always regenerated by the apply tool (default),
   * if so, does it need to be published, or should it be committed?
   * will affect the behavior for features like gitignore:
   **/
  type?: "ephemeral" | "committed";
  /** should this file be published when making a distributable package */
  publish?: boolean;
  /** if passed in an object, the correct stringifier is chosen based on the file extension */
  content?: string | object;
  path: string;
  /** list of target packages inside of which the file will be created/updated */
  // TODO: maybe it should support targetting by package.json keywords?
  targetPackages?: string[];
}

export interface CollectedState {
  /** these files will be created during execution */
  files: FileDef[];
  /** we'll ensure these dependencies are installed during execution */
  devDependencies: (string | DependencyDef)[];
  tasks: Task[];
}

export interface StateFlags {
  preventAdditionalTasks?: boolean;
}

export type ToIntermediateState<T> = {
  [P in keyof T]: T[P] extends Array<infer O>
    ? ReadonlyArray<O | false | undefined>
    : T[P];
};

export type State = ToIntermediateState<CollectedState> & {
  flags?: ReadonlyArray<keyof StateFlags>;
};

export type FeatureActionFn = (
  config: RepoConfigWithInferredValues,
  state: State,
) => Partial<State> | Promise<Partial<State>>;

export interface FeatureDefinition {
  actionFn: FeatureActionFn;
  name: string;
  order?: {
    after?: Array<string>;
    priority?: "beginning" | "end";
  };
}

interface Conventions {
  /** @default 'src' */
  sourceDir?: string;
  sourceExtensions?: string[];
}

type GitConfig = {
  /** inferred from git if empty */
  defaultBranch?: string;
};

type NodeConfig = {
  /** @default 'yarn' */
  packageManager?: {
    name: "yarn" | "npm" | "pnpm";
    version?: string;
  };
  version?: string;
};

export interface RepoConfig {
  /** primary engine used to run the tool */
  engine: "node" | "bun";
  // node: PartialNodeConfig;
  node?: NodeConfig;
  git?: GitConfig;
  features: FeatureDefinition[];
  /** when present, assumes monorepo */
  projects?: WorkspaceProjectsConvention[];
  conventions?: Conventions;
}

export const CONFIGURED = Symbol("Configured");

export interface ConfiguredRepoConfig extends RepoConfig {
  [CONFIGURED]: true;
}

export const configure = (config: RepoConfig): ConfiguredRepoConfig => ({
  ...config,
  [CONFIGURED]: true,
});

export interface RepoConfigWithInferredValues extends RepoConfig {
  manifest: PackageJson;
  workspaceDir: string;
  conventions: Required<Conventions>;
  git: Required<GitConfig>;
  node: Required<NodeConfig>;
}
