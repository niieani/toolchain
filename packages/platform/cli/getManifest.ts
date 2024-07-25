import * as path from "node:path";
import { findUp } from "@condu/core/utils/findUp.js";
import type { WorkspaceRootPackage } from "@condu/types/configTypes.js";
import { topoFromWorkspace } from "@condu/workspace-utils/topo.js";
import * as fs from "node:fs";
import {
  CONDU_CONFIG_DIR_NAME,
  CONDU_CONFIG_FILE_NAME,
} from "@condu/types/constants.js";

export async function getManifest(cwd: string): Promise<WorkspaceRootPackage> {
  const configDirPath = await findUp(
    async (file) => {
      if (file.name === CONDU_CONFIG_DIR_NAME) {
        return fs.promises.exists(
          path.join(
            file.parentPath,
            CONDU_CONFIG_DIR_NAME,
            CONDU_CONFIG_FILE_NAME,
          ),
        );
      }
      return false;
    },
    { cwd, type: "directory" },
  );
  const workspaceDir = configDirPath ? path.dirname(configDirPath) : cwd;
  const configFilePath = path.join(
    workspaceDir,
    CONDU_CONFIG_DIR_NAME,
    CONDU_CONFIG_FILE_NAME,
  );

  // const root = await getPackage();
  const topology = await topoFromWorkspace({ cwd: workspaceDir });

  return {
    kind: "workspace",
    ...topology.root,
  };
}
