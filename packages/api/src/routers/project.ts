import {
  createProjectProcedure,
  deleteProjectProcedure,
  listProjectsProcedure,
  updateProjectProcedure,
} from "@crikket/bug-reports/procedures/projects"

export const projectRouter = {
  list: listProjectsProcedure,
  create: createProjectProcedure,
  update: updateProjectProcedure,
  delete: deleteProjectProcedure,
}
