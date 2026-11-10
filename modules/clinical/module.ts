import { defineModule } from "@aihot/contracts/modules";
export default defineModule({ name: "clinical", pages: [
  { path: "clinical", file: "web/index.tsx" },
  { path: "clinical/items/:id", file: "web/detail.tsx" },
  { path: "clinical/weekly", file: "web/weekly.tsx" },
  { path:"clinical/questions",file:"web/questions.tsx" },
  { path: "clinical/manage", file: "web/manage.tsx" },
], apiPaths: [/^\/api\/clinical(?:\/|$)/] });
