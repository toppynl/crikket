import { configure } from "@crikket/github/procedures/configure"
import { deleteConfig } from "@crikket/github/procedures/delete-config"
import { getConfig } from "@crikket/github/procedures/get-config"
import { pushIssue } from "@crikket/github/procedures/push-issue"
import {
  configureProjectGithub,
  deleteProjectGithubConfigProcedure,
} from "@crikket/github/procedures/configure-project"
import { getProjectGithubConfigProcedure } from "@crikket/github/procedures/get-project-config"
import { listRepos } from "@crikket/github/procedures/list-repos"

export const githubRouter = {
  configure,
  deleteConfig,
  getConfig,
  pushIssue,
  configureProject: configureProjectGithub,
  deleteProjectConfig: deleteProjectGithubConfigProcedure,
  getProjectConfig: getProjectGithubConfigProcedure,
  listRepos,
}
