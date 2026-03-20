import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSeed } from "../../../shared/types.ts";
import { InMemoryDatabase } from "./in-memory-database.ts";

interface ManagedStatePayload {
  version: 1;
  apps?: DatabaseSeed["apps"];
  roles?: DatabaseSeed["roles"];
  rolePermissions?: DatabaseSeed["rolePermissions"];
  appConfigs?: DatabaseSeed["appConfigs"];
}

export interface ManagedStatePersistence {
  load(): Partial<DatabaseSeed>;
  save(database: InMemoryDatabase): void;
}

export class NoopManagedStatePersistence implements ManagedStatePersistence {
  load(): Partial<DatabaseSeed> {
    return {};
  }

  save(): void {}
}

export class FileManagedStatePersistence implements ManagedStatePersistence {
  constructor(private readonly filePath: string) {}

  load(): Partial<DatabaseSeed> {
    if (!existsSync(this.filePath)) {
      return {};
    }

    const raw = readFileSync(this.filePath, "utf8");
    if (!raw.trim()) {
      return {};
    }

    const payload = JSON.parse(raw) as ManagedStatePayload;

    return {
      apps: Array.isArray(payload.apps) ? payload.apps : undefined,
      roles: Array.isArray(payload.roles) ? payload.roles : undefined,
      rolePermissions: Array.isArray(payload.rolePermissions) ? payload.rolePermissions : undefined,
      appConfigs: Array.isArray(payload.appConfigs) ? payload.appConfigs : undefined,
    };
  }

  save(database: InMemoryDatabase): void {
    const payload: ManagedStatePayload = {
      version: 1,
      apps: structuredClone(database.apps),
      roles: structuredClone(database.roles),
      rolePermissions: structuredClone(database.rolePermissions),
      appConfigs: structuredClone(database.appConfigs),
    };

    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(payload, null, 2), "utf8");
    renameSync(temporaryPath, this.filePath);
  }
}

export function createManagedStatePersistence(filePath?: string): ManagedStatePersistence {
  if (!filePath?.trim()) {
    return new NoopManagedStatePersistence();
  }

  return new FileManagedStatePersistence(filePath.trim());
}

export function applyManagedState(baseSeed: DatabaseSeed, persisted: Partial<DatabaseSeed>): DatabaseSeed {
  return {
    ...baseSeed,
    apps: persisted.apps ?? baseSeed.apps ?? [],
    roles: persisted.roles ?? baseSeed.roles ?? [],
    rolePermissions: persisted.rolePermissions ?? baseSeed.rolePermissions ?? [],
    appConfigs: persisted.appConfigs ?? baseSeed.appConfigs ?? [],
  };
}
