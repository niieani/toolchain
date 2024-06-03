import { defineFeature } from "@condu/core/defineFeature.js";
import {
  CONDU_WORKSPACE_PACKAGE_NAME,
  CORE_NAME,
} from "@condu/core/constants.js";

export const condu = ({}: {} = {}) =>
  defineFeature({
    name: "condu",
    actionFn: (config, state) => {
      const isInternalCondu =
        config.project.manifest.name === CONDU_WORKSPACE_PACKAGE_NAME;
      return {
        effects: [
          {
            tasks: [
              {
                type: "publish",
                name: "release",
                definition: {
                  // TODO: add configurability/arguments
                  command: `${
                    isInternalCondu
                      ? `${config.node.packageManager.name} run `
                      : ""
                  }${CORE_NAME} release`,
                },
              },
            ],
          },
        ],
      };
    },
  });
