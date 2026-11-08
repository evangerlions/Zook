/** Explicit synthetic localhost fixture; production domain and CSV worker, controlled historical clocks. */
import {Pool} from "pg";
import {writeFileSync} from "node:fs";
import {runPostgresMigrations} from "../../src/infrastructure/database/postgres/migrate.ts";
import {PostgresLightTickRepository} from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import {strategyFixture} from "./lighttick-strategy-fixture.ts";
const dsn=process.env.GROW_WEB_TEST_DSN;
if(!dsn||new URL(dsn).hostname!=="127.0.0.1"||!/^\/grow_web_u1_[a-f0-9]+$/.test(new URL(dsn).pathname))throw Error("Dedicated synthetic localhost DB required");
await runPostgresMigrations({connectionString:dsn,log:()=>{}});const pool=new Pool({connectionString:dsn});
try{const f=await strategyFixture(new PostgresLightTickRepository(pool),"user_course_9");writeFileSync(".artifacts/strategies-20261107/fixture.json",JSON.stringify({synthetic:true,owner:f.o.userId,controlled_source_clock:"2026-11-06T08:00:00Z",instrument:f.instrument,source_id:f.daily.id,source_digest:f.daily.dataset.input_digest,strategy_id:f.d.id,body:f.body},null,2));console.log("Synthetic strategy fixture seeded through domain/CSV worker");}finally{await pool.end();}
