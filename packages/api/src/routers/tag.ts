import {
  createTagProcedure,
  deleteTagProcedure,
  listTagsProcedure,
  updateTagProcedure,
} from "@crikket/bug-reports/procedures/tags"

export const tagRouter = {
  list: listTagsProcedure,
  create: createTagProcedure,
  update: updateTagProcedure,
  delete: deleteTagProcedure,
}
