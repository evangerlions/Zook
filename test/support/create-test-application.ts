import {
  createApplication as createRuntimeApplication,
  type CreateApplicationOptions,
} from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

export type { CreateApplicationOptions } from "../../src/app.module.ts";

export async function createApplication(options: CreateApplicationOptions = {}) {
  if (!process.env.APP_ENV) {
    process.env.APP_ENV = "test";
  }

  return await createRuntimeApplication({
    ...options,
    databaseFactory: options.databaseFactory ?? ((seed) => new InMemoryDatabase(seed)),
  });
}
