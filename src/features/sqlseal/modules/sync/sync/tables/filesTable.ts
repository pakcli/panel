import { App, Plugin, TFile } from "obsidian";
import { AFileSyncTable } from "./abstractFileSyncTable";
import { sanitise } from "../../../../utils/sanitiseColumn";
import { SqlocalDatabaseProxy } from "../../../database/sqlocal/sqlocalDatabaseProxy";
import Papa from "papaparse";
import { parse as parseJson5 } from "json5";


export const FILES_TABLE_NAME = 'files'


const extractFrontmatterFromFile = (file: TFile, plugin: Plugin): Record<string, unknown> => {
    const frontmatter = plugin.app.metadataCache.getFileCache(file)?.frontmatter || {}

    return Object.fromEntries(
        Object.entries(frontmatter)
            .map(([v, s]) => ([sanitise(v), s]))
    )
}

async function getFileRowCount(app: App, file: TFile): Promise<number | null> {
    const ext = file.extension.toLowerCase();
    try {
        if (ext === 'csv' || ext === 'tsv') {
            const content = await app.vault.read(file);
            if (!content || !content.trim()) return 0;
            const delimiter = ext === 'tsv' ? '\t' : ',';
            const parsed = Papa.parse<string[]>(content, {
                delimiter,
                skipEmptyLines: 'greedy',
            });
            if (parsed.data.length === 0) return 0;
            return Math.max(0, parsed.data.length - 1);
        } else if (ext === 'json' || ext === 'json5') {
            const content = await app.vault.read(file);
            if (!content || !content.trim()) return 0;
            let parsed;
            try {
                parsed = JSON.parse(content);
            } catch {
                try {
                    parsed = parseJson5(content);
                } catch {
                    // Fail silently/gracefully on corrupted or incomplete JSON (e.g. empty or mid-write state)
                    return null;
                }
            }
            if (Array.isArray(parsed)) return parsed.length;
            if (typeof parsed === 'object' && parsed !== null) return Object.keys(parsed).length;
            return 1;
        } else if (ext === 'jsonl') {
            const content = await app.vault.read(file);
            if (!content || !content.trim()) return 0;
            const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
            return lines.length;
        }
    } catch (e) {
        // Log softly as debug/warn rather than uncaught error dump
        console.debug("Silent row count fallback for file:", file.path);
    }
    return null;
}

async function fileData(app: App, file: TFile, { ...frontmatter }: Record<string, unknown>) {
    const rowCount = await getFileRowCount(app, file);
    return {
        ...frontmatter,
        id: file.path,
        path: file.path,
        name: file.basename,
        created_at: (new Date(file.stat.ctime)).toISOString(),
        modified_at: (new Date(file.stat.mtime)).toISOString(),
        file_size: file.stat.size,
        row_count: rowCount
    }
}

export class FilesFileSyncTable extends AFileSyncTable {
    get tableName() {
        return FILES_TABLE_NAME
    }

    private columns: Array<string> = []

    async onFileModify(file: TFile) {
        await this.onFileDelete(file.path)
        await this.onFileCreate(file)
    }

    async onFileDelete(file: string) {
        await this.db.deleteData(this.tableName, [{
            path: file
        }], 'path')
    }

    async onFileCreate(file: TFile): Promise<void> {
        const data = await fileData(this.app, file, extractFrontmatterFromFile(file, this.plugin))
        const unexistingColumns = Object.keys(data).filter(x => !this.columns.includes(x))
        if (unexistingColumns.length) {
            await this.db.addColumns(this.tableName, unexistingColumns)
            this.columns = (await this.db.getColumns(this.tableName)) ?? []
        }
        await this.db.insertData(this.tableName, [data])
    }

    async onFileCreateBulk(files: Array<TFile>) {
        this.columns = (await this.db.getColumns(this.tableName)) ?? []

        for (const file of files) {
            await this.onFileCreate(file)
        }
    }

    async onInit(): Promise<void> {
        await this.db.createTableNoTypes(FILES_TABLE_NAME, ['id', 'name', 'path', 'created_at', 'modified_at', 'file_size', 'row_count'])
        this.columns = (await this.db.getColumns(this.tableName)) ?? []
        const indices = ['id', 'name', 'path']
        await Promise.all(indices.map(x => this.db.createIndex(`files_${x}_idx`, FILES_TABLE_NAME, [x])))
    }

    constructor(
        private db: SqlocalDatabaseProxy,
        private app: App,
        private plugin: Plugin
    ) {
        super()
    }
}
