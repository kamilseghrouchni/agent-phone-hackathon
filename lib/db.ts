import Database from "better-sqlite3";
import path from "node:path";

let _views: Database.Database | null = null;

/** Single connection to views.db, ATTACHing the canonical specimens.db read-only. */
export function db(): Database.Database {
  if (_views) return _views;
  const viewsPath = path.join(process.cwd(), "data", "enriched", "views.db");
  const srcPath = path.join(process.cwd(), "data", "specimens.db");
  const conn = new Database(viewsPath, { readonly: true, fileMustExist: true });
  conn.exec(`ATTACH DATABASE '${srcPath}' AS src`);
  _views = conn;
  return conn;
}
