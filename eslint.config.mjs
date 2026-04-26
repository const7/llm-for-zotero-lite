// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";

export default zotero({
  overrides: [
    {
      files: ["**/*.ts"],
      rules: {
        "@typescript-eslint/no-unused-vars": "off",
        "@typescript-eslint/no-require-imports": "off",
        "no-control-regex": "off",
      },
    },
    {
      files: ["test/**/*.ts"],
      rules: {
        "mocha/consistent-spacing-between-blocks": "off",
        "mocha/max-top-level-suites": "off",
        "mocha/no-setup-in-describe": "off",
      },
    },
  ],
});
