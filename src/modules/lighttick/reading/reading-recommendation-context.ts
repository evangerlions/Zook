import type {ReadingWorkService} from "./reading-work.service.ts";
import type {ReadingWork} from "./reading-work.types.ts";
export const READING_EXTRACTION_VERSION="lighttick-fulltext-v1/pdfjs-6.5.438/readability-0.6.0/linkedom-0.18.15";
export async function validateReadingRecommendation(service:ReadingWorkService,row:ReadingWork){
 const frozen=row.input.recommendation;if(!frozen)return;
 const current=await service.store.preferences.get(row);
 if((current?.revision??0)!==frozen.scope.preferences.revision||frozen.scope.extraction_version!==READING_EXTRACTION_VERSION)throw Error("READING_CONTEXT_STALE");
 const all=await service.store.sources(row,"",1001,true),byId=new Map(all.map(s=>[s.id,s]));
 if(all.length>1000)throw Error("READING_CONTEXT_STALE");
 for(const selected of frozen.scope.sources){const latest=byId.get(selected.id);
  if(selected.revision===0?(!!latest||all.some(s=>s.id!==selected.id&&"source-catalog-"+(s.catalog_origin_id??s.catalog_id)===selected.id)):!latest||latest.revision!==selected.revision||latest.archived||latest.deleted_at)throw Error("READING_CONTEXT_STALE");
 }
}

