import { CacheHelper } from "./cache.js";
import { Awaitable, getSurrealDB, TallyTransaction } from "./index.js";
import { LiveMessage, RecordId, Table } from "surrealdb";
import z from "zod";

export class DBMap<T extends z.ZodTypeAny, D = z.infer<T> | null> {
  protected name: string;
  protected schema: T;
  defaultV: D extends null ? D : z.infer<T>;
  private cache: CacheHelper<z.infer<T>>;

  private constructor(
    name: string,
    schema: T,
    defaultV: D extends null ? D : z.infer<T>,
  ) {
    this.name = name;
    this.schema = schema;
    this.defaultV = defaultV;
    this.cache = new CacheHelper("map", name);
    this.live((msg) => {
      switch (msg.action) {
        case "CREATE":
        case "UPDATE":
          this.cache.set(
            [msg.recordId.toString().split(":")[1]],
            msg.value.value as any,
          );
          break;
        case "DELETE":
          this.cache.invalidate([
            msg.recordId.toString().split(":")[1] as string,
          ]);
          break;
      }
    });
  }

  static async create<T extends z.ZodTypeAny, D = z.infer<T> | null>(
    name: string,
    schema: T,
    defaultV: D extends null ? D : z.infer<T>,
  ): Promise<DBMap<T, D>> {
    const instance = new this(name, schema, defaultV);
    await getSurrealDB().query(`DEFINE TABLE ${instance.name} SCHEMALESS;`);
    return instance;
  }

  async get(
    key: string,
    transaction?: TallyTransaction,
  ): Promise<D extends null ? z.infer<T> | null : z.infer<T>> {
    if (transaction) {
      const res = await transaction.select<{ value: z.infer<T> }>(
        new RecordId(this.name, key),
      );
      if (!res || !res.value) return this.defaultV as any;
      return this.schema.parse(res.value);
    }
    const cached = this.cache.get([key]);
    if (cached) return cached;
    const res = await getSurrealDB().select<{ value: z.infer<T> }>(
      new RecordId(this.name, key),
    );
    if (!res || !res.value) return this.defaultV as any;
    return this.schema.parse(res.value);
  }

  async set(key: string, data: z.infer<T>, transaction?: TallyTransaction) {
    if (transaction) {
      transaction.onCommit(() => {
        this.cache.invalidate([key]);
      });
      await transaction
        .upsert(new RecordId(this.name, key))
        .content({ value: data });
      return;
    }
    this.cache.set([key], data);
    await getSurrealDB()
      .upsert(new RecordId(this.name, key))
      .content({ value: data });
  }

  async delete(key: string, transaction?: TallyTransaction) {
    if (transaction) {
      transaction.onCommit(() => {
        this.cache.invalidate([key]);
      });
      await transaction.delete(new RecordId(this.name, key));
      return;
    }
    this.cache.invalidate([key]);
    await getSurrealDB().delete(new RecordId(this.name, key));
  }
  async allKeys(transaction?: TallyTransaction): Promise<string[]> {
    if (transaction) {
      const sql = `SELECT id FROM ${this.name}`;
      const rows = await transaction.query(sql);
      return (rows[0] as { id: RecordId }[]).map(({ id }) => {
        return id.id.toString();
      });
    }
    const sql = `SELECT id FROM ${this.name}`;
    const rows = await getSurrealDB().query(sql);
    return (rows[0] as { id: RecordId }[]).map(({ id }) => {
      return id.id.toString();
    });
  }

  async live(callback?: (message: LiveMessage) => Awaitable<void>) {
    const sub = await getSurrealDB().live<z.infer<T>>(new Table(this.name));

    if (callback) {
      (async () => {
        try {
          for await (const update of sub) {
            console.log("Update:", update.action, update.value);
            await callback(update);
          }
        } catch (err) {
          console.error("Live subscription error:", err);
        }
      })();
    }

    return sub;
  }
}
