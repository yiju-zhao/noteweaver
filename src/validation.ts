/** Read-only validation API shipped with each release for downstream compatibility checks. */
export { readSchema, readFrontmatter, specFor, pageName, validate, claimedAttributes } from "./core";
export { checkRelations } from "./relations";
export const apiVersion = 1;
export const schemaVersion = 3;

export { readInstanceConfig, schemaPath, instanceSchemaPath } from "./instance";
