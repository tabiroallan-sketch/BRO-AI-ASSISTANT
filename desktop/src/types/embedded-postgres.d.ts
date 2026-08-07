/**
 * Ambient types for the `embedded-postgres` package.
 *
 * The package ships ESM-only with an `exports` map that only exposes the
 * package root, so a bare `require('embedded-postgres')` is required at
 * runtime (Node >= 22 `require(esm)`, as bundled by Electron 43). Its own
 * declaration file cannot be resolved under this workspace's CJS + node10
 * module resolution, so the small surface we use is declared here instead.
 */

declare module 'embedded-postgres' {
  export type EmbeddedPostgresOptions = {
    databaseDir: string;
    port?: number;
    host?: string;
    user?: string;
    password?: string;
    persistent?: boolean;
    authMethod?: 'trust' | 'password' | 'md5' | 'scram-sha-256';
    initdbFlags?: string[];
    postgresFlags?: string[];
    onLog?: (message: string) => void;
    onError?: (error: Error) => void;
    onExit?: (code: number) => void;
  };

  export default class EmbeddedPostgres {
    constructor(options: EmbeddedPostgresOptions);
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    createDatabase(databaseName: string): Promise<void>;
    createUser(username: string, password: string): Promise<void>;
    getPgClient(database?: string, host?: string): Promise<import('pg').Client>;
  }
}
