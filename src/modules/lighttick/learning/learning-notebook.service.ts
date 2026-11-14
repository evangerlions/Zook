import type { NativeLearningService } from "./native-learning.service.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { fail } from "./native-learning.validation.ts";
export function notebookQuery(query: Record<string,string | undefined>) {
  const q=(query.q ?? "").trim(), module=query.module ?? "";
  if(q.includes("\0") || q.length>500 || module.length>100 || (module && !/^(?:module\/[a-z][a-z0-9-]{0,79}|courses|unassigned)$/.test(module))) fail(422,"Invalid notebook search or module.");
  const number=(value:string | undefined,fallback:number,max:number)=>{
    if(value===undefined)return fallback;
    if(!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value)>max)fail(422,"Invalid notebook page or page size.");
    return Number(value);
  };
  return {q,module,page:number(query.page,1,1000000),page_size:number(query.page_size,20,100)};
}
export class LearningNotebookService {
  constructor(private readonly learning: NativeLearningService) {}
  async list(owner: LightTickOwner, query: Record<string,string | undefined>) {
    const input=notebookQuery(query);
    return this.learning.repository.transaction(owner,async()=>{
      const authority=await this.learning.requireActive(owner);
      if(!authority.readingEnabled || !authority.privateEnabled)fail(403,"Reading and private learning consent are required.");
      return this.learning.repository.queryLearningNotebook(owner,input);
    });
  }
}
