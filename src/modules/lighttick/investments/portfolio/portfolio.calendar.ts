import { referenceCalendar, type MarketCalendar } from "../market/market.calendar.ts";
import type { PortfolioContext, PortfolioInput } from "./portfolio.types.ts";
export function valuationCalendarStart(date:string){const start=new Date(Date.parse(date)-31*86400000).toISOString().slice(0,10);return start<"2026-01-01"&&date>="2026-01-01"?"2026-01-01":start;}
export function freezePortfolioCalendars(input:PortfolioInput,now:Date):MarketCalendar[]{
 if(input.kind==="baseline")return [];
 const start=input.kind==="valuation"?valuationCalendarStart(input.date):input.start,end=input.kind==="valuation"?input.date:input.end;
 return ["SSE","SZSE","BSE"].map(m=>referenceCalendar(m,start,end,now));
}
/** Consume the captured snapshot, never substitute a newer calendar during recovery. */
export function frozenCalendar(c:PortfolioContext,market:string,start:string,end:string):MarketCalendar {
 const cal=c.calendars?.find(cal=>cal.market===market&&cal.start<=start&&cal.end>=end);
 if(!cal)throw Error("PORTFOLIO_CALENDAR_UNAVAILABLE");
 return cal;
}
