import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";

interface PublicationFile {
  before?: string;
  after: string;
  text: string;
  size: number;
}

interface PublicationJournal {
  id: string;
  owner: LightTickOwner;
  moduleId?: string;
  requestHash: string;
  state: "pending" | "processing" | "done" | "failed";
  files: Record<string, PublicationFile>;
  sql?: Array<{ query: string; params: unknown[] }>;
  binding?: Record<string, unknown>;
  commitSha?: string;
  parentSha?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  finishedAt?: string;
}

type Query = (sql: string, values?: unknown[]) => Promise<{
  rows: Record<string, unknown>[];
}>;

function mapRow(row: Record<string, unknown>): PublicationJournal {
  return {
    id: row.id as string,
    owner: {
      appId: row.app_id as string,
      userId: row.user_id as string,
    },
    moduleId: row.module_id as string | undefined,
    requestHash: row.request_hash as string,
    state: row.state as PublicationJournal["state"],
    files: row.files as Record<string, PublicationFile>,
    sql: row.sql_operations as Array<{ query: string; params: unknown[] }> | undefined,
    binding: row.binding as Record<string, unknown> | undefined,
    commitSha: row.commit_sha as string | undefined,
    parentSha: row.parent_sha as string | undefined,
    errorCode: row.error_code as string | undefined,
    errorMessage: row.error_message as string | undefined,
    createdAt: row.created_at as string,
    finishedAt: row.finished_at as string | undefined,
  };
}

export class PostgresPublicationRepository {
  constructor(private readonly query: Query) {}

  async getPublication(owner: LightTickOwner, id: string): Promise<PublicationJournal | undefined> {
    const result = await this.query(
      `SELECT * FROM zook_lighttick_content_publications
       WHERE app_id = $1 AND user_id = $2 AND id = $3`,
      [owner.appId, owner.userId, id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async getPublicationByHash(owner: LightTickOwner, hash: string): Promise<PublicationJournal | undefined> {
    const result = await this.query(
      `SELECT * FROM zook_lighttick_content_publications
       WHERE app_id = $1 AND user_id = $2 AND request_hash = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [owner.appId, owner.userId, hash],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async savePublication(journal: PublicationJournal): Promise<void> {
    await this.query(
      `INSERT INTO zook_lighttick_content_publications
       (id, app_id, user_id, module_id, request_hash, state, files, sql_operations, binding, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        journal.id,
        journal.owner.appId,
        journal.owner.userId,
        journal.moduleId,
        journal.requestHash,
        journal.state,
        JSON.stringify(journal.files),
        journal.sql ? JSON.stringify(journal.sql) : null,
        journal.binding ? JSON.stringify(journal.binding) : null,
        journal.createdAt,
      ],
    );
  }

  async updatePublicationState(
    id: string,
    state: string,
    updates?: Partial<PublicationJournal>,
  ): Promise<void> {
    const setClauses: string[] = ["state = $2", "updated_at = NOW()"];
    const values: unknown[] = [id, state];
    let paramIndex = 3;

    if (updates?.commitSha) {
      setClauses.push(`commit_sha = $${paramIndex}`);
      values.push(updates.commitSha);
      paramIndex++;
    }
    if (updates?.parentSha) {
      setClauses.push(`parent_sha = $${paramIndex}`);
      values.push(updates.parentSha);
      paramIndex++;
    }
    if (updates?.errorCode) {
      setClauses.push(`error_code = $${paramIndex}`);
      values.push(updates.errorCode);
      paramIndex++;
    }
    if (updates?.errorMessage) {
      setClauses.push(`error_message = $${paramIndex}`);
      values.push(updates.errorMessage);
      paramIndex++;
    }
    if (updates?.finishedAt) {
      setClauses.push(`finished_at = $${paramIndex}`);
      values.push(updates.finishedAt);
      paramIndex++;
    }
    if (updates?.errorCode === undefined && updates?.errorMessage === undefined) {
      setClauses.push("error_code = NULL", "error_message = NULL");
    }
    if (updates?.finishedAt === undefined) {
      setClauses.push("finished_at = NULL");
    }

    await this.query(
      `UPDATE zook_lighttick_content_publications SET ${setClauses.join(", ")} WHERE id = $1`,
      values,
    );
  }

  async listPendingPublications(): Promise<PublicationJournal[]> {
    const result = await this.query(
      `SELECT * FROM zook_lighttick_content_publications
       WHERE state IN ('pending', 'processing')
       ORDER BY created_at ASC`,
      [],
    );
    return result.rows.map(mapRow);
  }
}
