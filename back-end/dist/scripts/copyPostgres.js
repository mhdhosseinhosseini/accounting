"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Parse CLI args of the form --src=URL --dest=URL [--dump=path] [--force]
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const out = {};
    for (const a of args) {
        if (a.startsWith('--src='))
            out.src = a.substring('--src='.length);
        else if (a.startsWith('--dest='))
            out.dest = a.substring('--dest='.length);
        else if (a.startsWith('--dump='))
            out.dump = a.substring('--dump='.length);
        else if (a === '--force')
            out.force = true;
    }
    return out;
}
/**
 * Ensure required binaries (pg_dump, psql, createdb, dropdb) are available.
 * Returns true if all are found; otherwise logs guidance and returns false.
 */
function checkBinaries() {
    const bins = ['pg_dump', 'psql', 'createdb', 'dropdb'];
    let ok = true;
    for (const b of bins) {
        const res = (0, child_process_1.spawnSync)(b, ['--version'], { stdio: 'pipe' });
        if (res.status !== 0) {
            console.error(`[ERROR] Missing binary: ${b}. Install PostgreSQL client tools.`);
            ok = false;
        }
    }
    if (!ok) {
        console.error('On macOS, you can install with Homebrew: brew install postgresql@18');
    }
    return ok;
}
/**
 * Extract the database name from a Postgres connection URL.
 * Supports forms like postgresql://user:pass@host:5432/dbname?params
 */
function parseDbNameFromUrl(url) {
    try {
        const u = new URL(url);
        // pathname starts with "/dbname"
        return (u.pathname || '').replace(/^\//, '').split('?')[0];
    }
    catch (e) {
        throw new Error(`Invalid Postgres URL: ${url}`);
    }
}
/**
 * Parse connection options (host, port, user) from a Postgres URL.
 * Returns sensible defaults when parts are missing.
 */
function parseConnOptions(url) {
    const u = new URL(url);
    const host = u.hostname || 'localhost';
    const port = u.port ? Number(u.port) : 5432;
    const user = u.username || process.env.USER || undefined;
    return { host, port, user };
}
/**
 * Dump a remote/source database to a SQL file using pg_dump.
 * Uses --no-owner and --no-privileges to ease restore into local DB.
 */
function dumpDatabase(srcUrl, dumpFile) {
    const dir = path.dirname(dumpFile);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    console.log(`[INFO] Dumping source DB to ${dumpFile} ...`);
    const res = (0, child_process_1.spawnSync)('pg_dump', ['--no-owner', '--no-privileges', srcUrl, '-f', dumpFile], { stdio: 'inherit' });
    if (res.status !== 0) {
        throw new Error('pg_dump failed. Check connectivity and credentials for SRC URL.');
    }
}
/**
 * Create (or re-create with --force) the destination database using createdb/dropdb.
 * Honors host/port/user from the destination URL so non-default servers work.
 */
function ensureDestinationDb(destUrl, force) {
    const dbName = parseDbNameFromUrl(destUrl);
    const { host, port, user } = parseConnOptions(destUrl);
    if (force) {
        console.log(`[INFO] Dropping destination DB if exists: ${dbName}`);
        (0, child_process_1.spawnSync)('dropdb', ['--if-exists', '-h', host, '-p', String(port), ...(user ? ['-U', user] : []), dbName], { stdio: 'inherit' });
    }
    console.log(`[INFO] Creating destination DB: ${dbName}`);
    const res = (0, child_process_1.spawnSync)('createdb', ['-h', host, '-p', String(port), ...(user ? ['-U', user] : []), dbName], { stdio: 'inherit' });
    if (res.status !== 0) {
        throw new Error('createdb failed. Ensure local Postgres is running and you have permission.');
    }
}
/**
 * Restore the SQL dump file into the destination database using psql.
 * Honors host/port/user from the destination URL.
 */
function restoreDatabase(destUrl, dumpFile) {
    const dbName = parseDbNameFromUrl(destUrl);
    const { host, port, user } = parseConnOptions(destUrl);
    console.log(`[INFO] Restoring dump into destination DB: ${dbName}`);
    const res = (0, child_process_1.spawnSync)('psql', ['-h', host, '-p', String(port), ...(user ? ['-U', user] : []), dbName, '-f', dumpFile], { stdio: 'inherit' });
    if (res.status !== 0) {
        throw new Error('psql restore failed. Check local DB permissions and dump validity.');
    }
}
/**
 * Main entrypoint: parse args, verify tools, perform dump → create → restore.
 */
function main() {
    const { src, dest, dump, force } = parseArgs();
    if (!src || !dest) {
        console.error('Usage: ts-node src/scripts/copyPostgres.ts --src=SRC_URL --dest=DEST_URL [--dump=tmp/acc_dump.sql] [--force]');
        console.error('Example SRC: postgresql://user:pass@acc:5432/accounting?schema=public');
        console.error('Example DEST: postgresql://postgres@localhost:5432/accounting_local');
        process.exit(1);
    }
    if (!checkBinaries())
        process.exit(2);
    const dumpFile = dump || path.join(process.cwd(), 'tmp', 'acc_dump.sql');
    dumpDatabase(src, dumpFile);
    ensureDestinationDb(dest, !!force);
    restoreDatabase(dest, dumpFile);
    console.log('[SUCCESS] Database copied to local machine.');
}
main();
