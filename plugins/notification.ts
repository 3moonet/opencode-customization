import type { Plugin } from "@opencode-ai/plugin"

export const SendNotification: Plugin = async ({ project, client, $, directory, worktree }) => {
  return {
    event: async ({ event }) => {
      switch (event.type) {
        case "session.idle":
          await $`osascript -e 'display notification "Session completed" with title "opencode"'`
          break
        case "session.error":
          await $`osascript -e 'display notification "Session error" with title "opencode"'`
          break
      }

      // 型定義に含まれないが存在する
      // ref. https://github.com/mohak34/opencode-notifier/blob/v0.1.15/src/index.ts#L137
      if ((event as any).type === "permission.asked") {
        await $`osascript -e 'display notification "Permission asked" with title "opencode"'`
      }
    },
  }
}
