import {READING_DEFAULT_SOURCES} from "./reading-catalog.ts";
import type {ReadingSource} from "./reading-work.types.ts";
import type {ReadingSelectedSource} from "./reading-recommendation.types.ts";
export interface ReadingSourceOption extends ReadingSelectedSource {available:boolean;reason:null|"archived"|"deleted"|"overridden";}
export function readingSourceOptions(all:ReadingSource[]):ReadingSourceOption[]{
 const ownIds=new Set(all.map(s=>s.id)),origins=new Set(all.flatMap(s=>[s.catalog_origin_id??s.catalog_id].filter((id):id is string=>!!id)));
 const selected=(s:ReadingSelectedSource):ReadingSelectedSource=>{const {id,revision,title,url,format,language,topics,domains,catalog_id}=s;return {id,revision,title,url,format,...(language===undefined?{}:{language}),...(topics===undefined?{}:{topics}),...(domains===undefined?{}:{domains}),...(catalog_id===undefined?{}:{catalog_id})};};
 return [...READING_DEFAULT_SOURCES.filter(s=>!ownIds.has(s.id)).map(s=>({...selected({...s,topics:[...s.topics],domains:[...s.domains],revision:0}),available:!origins.has(s.catalog_id),reason:origins.has(s.catalog_id)?"overridden" as const:null})),...all.map(s=>({...selected(s),available:!s.archived&&!s.deleted_at,reason:s.deleted_at?"deleted" as const:s.archived?"archived" as const:null}))].sort((a,b)=>a.id.localeCompare(b.id));
}
