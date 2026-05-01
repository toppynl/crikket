import {
  createProjectProcedure,
  deleteProjectProcedure,
  getProjectProcedure,
  listProjectsProcedure,
  updateProjectProcedure,
} from "@crikket/bug-reports/procedures/projects"

export const projectRouter = {
  list: listProjectsProcedure,
  get: getProjectProcedure,
  create: createProjectProcedure,
  update: updateProjectProcedure,
  delete: deleteProjectProcedure,
}
