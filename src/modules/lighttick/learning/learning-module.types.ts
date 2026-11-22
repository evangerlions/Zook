import type {LightTickOwner} from "../lighttick.types.ts";
export interface LearningModule extends LightTickOwner {
  id:string; title:string; description:string; templateId:string|null;
  revision:number; archived:boolean; createdAt:string; updatedAt:string;
}
export interface LearningModuleRepository {
  get(owner:LightTickOwner,id:string):Promise<LearningModule|undefined>;
  list(owner:LightTickOwner,after:string,limit:number,filter:"active"|"archived"|"all"):Promise<LearningModule[]>;
  save(row:LearningModule,base:number):Promise<void>;
  history(owner:LightTickOwner,id:string,before:number,limit:number):Promise<LearningModule[]>;
}
