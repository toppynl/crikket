import { configure } from "@crikket/github/procedures/configure"
import { deleteConfig } from "@crikket/github/procedures/delete-config"
import { getConfig } from "@crikket/github/procedures/get-config"
import { pushIssue } from "@crikket/github/procedures/push-issue"

export const githubRouter = {
  configure,
  deleteConfig,
  getConfig,
  pushIssue,
}
