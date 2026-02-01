import type { Plugin, Hooks } from "@opencode-ai/plugin"
import z from "zod";
import { readFile, writeFile } from "node:fs/promises";

type Event = Parameters<NonNullable<Hooks["event"]>>[0]["event"];

// event の型定義と返り値が一致しないことが多いので以下で確認
// const timestamp = new Date().toISOString()
// await $`echo '${JSON.stringify(event)}' > ${directory}/event-${timestamp}.json`

const zPermissionAskedEvent = z.object({
  type: z.literal("permission.asked"),
  properties: z.object({
    id: z.string(),
    permission: z.string(),
    always: z.array(z.string()),
  }),
});
type PermissionAskedEvent = z.infer<typeof zPermissionAskedEvent>;
const isPermissionAskedEvent = (event: unknown): event is PermissionAskedEvent => zPermissionAskedEvent.safeParse(event).success;

const permissionAskedHistory: PermissionAskedEvent[] = [];

const zPermissionRepliedEvent = z.object({
  type: z.literal("permission.replied"),
  properties: z.object({
    requestID: z.string(),
    reply: z.enum(["always", "once", "reject"]),
  }),
});
type PermissionRepliedEvent = z.infer<typeof zPermissionRepliedEvent>;
const isPermissionRepliedEvent = (event: unknown): event is PermissionRepliedEvent => zPermissionRepliedEvent.safeParse(event).success;

const zOpenCodeConfig = z.object({
  "$schema": z.literal("https://opencode.ai/config.json"),
  permission: z.record(z.string(), z.string().or(z.record(z.string(), z.string()))).optional(),
});
type OpenCodeConfig = z.infer<typeof zOpenCodeConfig>;
const isOpenCodeConfig = (config: unknown): config is OpenCodeConfig => zOpenCodeConfig.safeParse(config).success;

const zOpenCodeConfigWithPermission = zOpenCodeConfig.extend({
  permission: z.record(z.string(), z.string().or(z.record(z.string(), z.string()))),
});
type OpenCodeConfigWithPermission = z.infer<typeof zOpenCodeConfigWithPermission>;
const isOpenCodeConfigWithPermission = (config: unknown): config is OpenCodeConfigWithPermission => zOpenCodeConfigWithPermission.safeParse(config).success;

const getConfigWithPermission = (config: unknown): OpenCodeConfigWithPermission => {
  if (isOpenCodeConfigWithPermission(config)) return config;
  if (isOpenCodeConfig(config)) return { ...config, permission: config.permission ?? {} };
  return { $schema: "https://opencode.ai/config.json", permission: {} };
}

export const AutoUpdatePermissionPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    event: async ({ event }) => {
      // 型定義に含まれないが存在する
      // ref. https://github.com/mohak34/opencode-notifier/blob/v0.1.15/src/index.ts#L137
      if (isPermissionAskedEvent(event)) {
        permissionAskedHistory.push(event);
      }

      if (isPermissionRepliedEvent(event)) {
        const { requestID, reply } = event.properties;
        if (reply !== "always") return;

        const foundPermissionAskedEvent = permissionAskedHistory.find(event => event.properties.id === requestID);
        if (!foundPermissionAskedEvent) return;

        const openCodeJsonPath = directory + "/opencode.json";
        const openCodeJson = await readFile(openCodeJsonPath, "utf-8").catch(() => "{}");
        const openCodeConfig = JSON.parse(openCodeJson);
        const configWithPermission = getConfigWithPermission(openCodeConfig);
        
        const result = updateConfigObject(configWithPermission, foundPermissionAskedEvent.properties.permission, foundPermissionAskedEvent.properties.always);
        await writeFile(openCodeJsonPath, JSON.stringify(result, null, 2), "utf-8");
      }
    },
  }
}

const updateConfigObject = (config: OpenCodeConfigWithPermission, permissionName: string, newAllowedCommands: string[]): OpenCodeConfigWithPermission => {
  // edit は許可しない
  if (permissionName === "edit") return config;

  const targetPermission = getTargetPermissionOrFallback(config, permissionName);
  const builtTargetPermission = buildTargetPermission(targetPermission, newAllowedCommands);
  config.permission[permissionName] = builtTargetPermission;
  return config;
}

const getTargetPermissionOrFallback = (config: OpenCodeConfigWithPermission, permissionName: string): OpenCodeConfigWithPermission["permission"][string] | undefined => {
  if (permissionName in config.permission) return config.permission[permissionName];
}

const buildTargetPermission = (
  existingPermission: OpenCodeConfigWithPermission["permission"][string] | undefined,
  newAllowedCommands: string[]
): OpenCodeConfigWithPermission["permission"][string] | Record<string, "allow"> => {
  // 全て許可の場合 allow を直接記述
  if (newAllowedCommands.length === 1 && newAllowedCommands[0] === "*") return "allow";

  if (existingPermission === undefined || typeof existingPermission !== "string") {
    return Object.fromEntries(newAllowedCommands.map(command => [command, "allow"]));
  }

  newAllowedCommands.forEach(command => {
    existingPermission[command] = "allow";
  });
  return existingPermission;
}