/** Read-only validation API shipped with each release for downstream compatibility checks. */
export { readSchema, readFrontmatter, specFor, pageName, validate, claimedAttributes } from "./core";
export { checkRelations } from "./relations";
export const apiVersion = 1;
export const schemaVersion = 3;

export { INSTANCE_DIRECTORY, INSTANCE_CONFIG, readInstanceConfig, readVaultInstance } from "./instance";
export { planSourceBacklinks, setSourceBacklinks, readSourceLines } from "./source-backlinks";
