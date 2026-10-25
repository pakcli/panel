/**
 * codeblockPromptTemplates.ts
 * Generates actionable, production-grade AI prompt templates for any codeblock.
 * Supports tree architecture scaffolding, language-specific refactoring, and query analysis.
 *
 * Rules:
 * - If codeblock is EMPTY: Asks AI to design and create a complete, production-grade example.
 * - If codeblock is an INSTRUCTION/SURUHAN (e.g. comments/prompt): Asks AI to fulfill the instruction and build the architecture.
 * - If codeblock has CODE/STRUCTURE: Scaffolds, refactors, or analyzes the declared structure and follows any directives.
 */

interface PromptInputState {
    cleanCode: string;
    lang: string;
    isEmpty: boolean;
    isInstructionOnly: boolean;
    instruction: string;
}

function analyzePromptInput(code: string, rawLang: string): PromptInputState {
    const cleanCode = (code || '').trim();
    const lang = (rawLang || '').toLowerCase().trim();

    if (!cleanCode) {
        return { cleanCode, lang, isEmpty: true, isInstructionOnly: false, instruction: '' };
    }

    const lines = cleanCode.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const allComments = lines.every((l) => /^(\/\/|#|--|\/\*|\*|<!--)/.test(l));
    if (allComments) {
        const instruction = lines
            .map((l) => l.replace(/^(\/\/|#|--|\/\*|\*|<!--|-->|\*\/)\s*/, '').trim())
            .filter(Boolean)
            .join(' ');
        return { cleanCode, lang, isEmpty: false, isInstructionOnly: true, instruction };
    }

    // Single brief instruction line without dots or slashes
    if (lines.length === 1 && !lines[0].includes('.') && !lines[0].includes('/') && lines[0].length < 120) {
        return { cleanCode, lang, isEmpty: false, isInstructionOnly: true, instruction: lines[0] };
    }

    return { cleanCode, lang, isEmpty: false, isInstructionOnly: false, instruction: '' };
}

export function buildCodeblockPrompt(code: string, rawLang: string): string {
    const state = analyzePromptInput(code, rawLang);
    const { cleanCode, lang, isEmpty, isInstructionOnly, instruction } = state;

    // 1. Panel Tree & Tree Architecture Scaffolding
    if (
        lang.startsWith('panel-tree') ||
        lang.startsWith('tree-') ||
        lang === 'tree' ||
        lang === 'structure' ||
        lang.includes('cascading')
    ) {
        if (isEmpty) {
            return `Act as a Principal Software Engineer. The project architecture codeblock is currently empty.

Please design and generate a complete, production-grade example project architecture using the declarative \`panel-tree\` format with frontmatter directives (\`f?dependencies:\`, \`f?status:\`, \`f?tier:\`, \`f?tags:\`, \`f?priority:\`).

### 📖 Panel-Tree Syntax & Notation Guide (#NOTE GUIDE)
When generating the architecture, strictly adhere to these rules:

1. **GUIDE TAB USAGE (Hierarchical Depth)**:
   - **Level 0 (0 Tabs)**: Root-level files and root-level directories.
   - **Level 1 (1 Tab \`\\t\`)**: Direct children of root directories.
   - **Level N (N Tabs)**: Deeply nested tree hierarchy. Every child node strictly belongs to its immediate un-indented parent folder above it. Do NOT flatten.

2. **EXAMPLE OF EACH ELEMENT**:
   - **Folder Node**: A line without a file extension (e.g., \`src\`, \`components\`, \`assets\`). Must be created as a directory.
   - **File Node**: A line with a file extension or explicit filename (e.g., \`main.ts\`, \`config.json\`, \`schema.sql\`).
   - **Interactive Script**: Nodes indicating interactive execution (e.g., \`inifiledragndropableinteractive\`) accept dragged file paths via parameters.
   - **Inline Architectural Notes (# ... / postit:)**: Column-aligned comments explaining purpose or constraints.
   - **Inline Frontmatter Directives (f?...:)**: Directives such as \`f?dependencies:[...]\`, \`f?tags:[...]\`, \`f?status:active\`, \`f?priority:high\`.

### 🚨 OUTPUT INSTRUCTION:
- Do NOT provide conversational fluff or explanations.
- Do NOT generate boilerplate code or separate files.
- Output ONLY the single, complete, copy-pasteable \`\`\`panel-tree\`\`\` codeblock directly, ready to be pasted into Obsidian!`;
        }

        if (isInstructionOnly) {
            return `Act as a Principal Software Engineer. Based on the following project requirement / instruction:

> "${instruction}"

Please design and generate a complete, production-grade project architecture using the declarative \`panel-tree\` format.

### 📖 Panel-Tree Syntax & Notation Guide (#NOTE GUIDE)
1. **GUIDE TAB USAGE (Hierarchical Depth)**:
   - **Level 0 (0 Tabs)**: Root files & directories.
   - **Level 1 (1 Tab \`\\t\`)**: Direct children of root directories.
   - **Level N (N Tabs)**: Deeply nested hierarchy. Every child node strictly belongs to its immediate parent. Do NOT flatten.

2. **EXAMPLE OF EACH ELEMENT**:
   - **Folder Node**: Line without file extension (e.g., \`src\`, \`components\`).
   - **File Node**: Line with extension (e.g., \`app.ts\`, \`schema.json\`).
   - **Interactive Script**: Nodes like \`inifiledragndropableinteractive\` accepting dragged file paths.
   - **Inline Architectural Notes (# ... / postit:)**: Column-aligned comments explaining purpose.
   - **Inline Frontmatter Directives (f?...:)**: Directives wiring dependencies, tags, and lifecycle.

### 🚨 OUTPUT INSTRUCTION:
- Do NOT write conversational explanations.
- Output ONLY the single, complete, copy-pasteable \`\`\`panel-tree\`\`\` codeblock fulfilling the instruction above, ready to be pasted into Obsidian!`;
        }

        // Conditional feature detection inside the panel-tree codeblock
        const hasNotesOrPostit = /(#|postit:|note:|f\?note:)/i.test(cleanCode);
        const hasFrontmatter = /f\?[a-z0-9_-]+:/i.test(cleanCode);

        // 1. Build Guide Rules
        const guideRules: string[] = [
            `1. **GUIDE TAB USAGE (Hierarchical Depth)**:
   - **Level 0 (0 Tabs)**: Root files & directories.
   - **Level 1 (1 Tab \`\\t\`)**: Direct children of root directories.
   - **Level N (N Tabs)**: Deeply nested tree hierarchy. Every child node strictly belongs to its immediate un-indented parent folder above it. Do NOT flatten.`,
            `2. **EXAMPLE OF EACH ELEMENT**:
   - **Folder Node**: A line without a file extension (e.g., \`script\`, \`powershell\`, \`module\`). Must be created as a directory.
   - **File Node**: A line with a file extension or explicit filename (e.g., \`_mainmenu.ps1_\`, \`_mainmenu.json_\`). Must be scaffolded with production-ready boilerplate code.
   - **Interactive Script**: Nodes indicating interactive execution (e.g., \`inifiledragndropableinteractive\`) accept dragged file paths via parameters.`
        ];

        let ruleIdx = 3;
        // JIKA ADA POST-IT / NOTE -> INCLUDE; JIKA TIDAK ADA -> EXCLUDE
        if (hasNotesOrPostit) {
            guideRules.push(`${ruleIdx++}. **POST-IT & ARCHITECTURAL NOTES (# / postit / note)**:
   - Inline notes following \`#\` or \`postit:\` contain explicit architectural constraints, business logic, or developer instructions for that specific node.
   - You MUST strictly implement the exact requirements described in these notes.`);
        }

        // JIKA ADA FRONTMATTER DIRECTIVES -> INCLUDE; JIKA TIDAK ADA -> EXCLUDE
        if (hasFrontmatter) {
            guideRules.push(`${ruleIdx++}. **FRONTMATTER DIRECTIVES (f?...)**:
   - \`f?tags: [...]\` -> Map directly to YAML frontmatter tags.
   - \`f?status: ...\` -> Map to lifecycle status property.
   - \`f?dependencies: [...]\` -> Wire up internal imports/dependencies between scaffolded files.`);
        }

        // 2. Build Task Checklist
        const tasks: string[] = [
            `Scaffold each file with clean, production-ready boilerplate code.`
        ];

        if (hasFrontmatter) {
            tasks.push(`Accurately resolve and wire up internal imports based on the declared \`f?dependencies:\` lists.`);
            tasks.push(`Preserve all declared frontmatter properties (tags, status, priority, tier) in the generated notes/files.`);
        }

        if (hasNotesOrPostit) {
            tasks.push(`Strictly adhere to and execute any custom instructions, post-it notes, or architectural directives annotated in the tree.`);
        }

        tasks.push(`Provide a concise summary of the module relationships.`);

        const numberedTasks = tasks.map((t, idx) => `${idx + 1}. ${t}`).join('\n');

        return `Act as a Principal Software Engineer. Based on the following declarative project architecture:

### 📖 Panel-Tree Syntax & Notation Guide (#NOTE GUIDE)
When interpreting the declarative tree below, strictly adhere to these rules:

${guideRules.join('\n\n')}

---

\`\`\`panel-tree
${cleanCode}
\`\`\`

---

Please perform the following tasks:
${numberedTasks}`;
    }

    // 2. SQL & Database Queries
    if (['sql', 'sqlite', 'mysql', 'postgres', 'postgresql', 'cst'].includes(lang)) {
        if (isEmpty) {
            return `Act as a Principal Database Engineer. The query block is currently empty.

Please generate a comprehensive, production-grade SQL schema and query example demonstrating:
1. Normalized relational tables with primary/foreign keys, check constraints, and indexes.
2. Realistic seed data.
3. Advanced, optimized queries using CTEs, Window Functions, and aggregations.
4. Performance analysis and indexing recommendations.`;
        }

        if (isInstructionOnly) {
            return `Act as a Principal Database Engineer. Based on the following requirement:

> "${instruction}"

Please provide:
1. Complete, production-grade SQL schema design matching this requirement.
2. Optimized queries with proper indexing and constraints.
3. Performance and correctness analysis.`;
        }

        return `Act as a Principal Database Engineer. Analyze the following SQL query/schema:

\`\`\`sql
${cleanCode}
\`\`\`

Please review and provide:
1. Query optimization, index recommendations, and performance analysis.
2. Correctness check for syntax, edge cases, and NULL handling.
3. Formatted and optimized production version of this query.`;
    }

    // 3. TypeScript & JavaScript
    if (['typescript', 'ts', 'tsx', 'javascript', 'js', 'jsx'].includes(lang)) {
        const langTag = lang.includes('ts') ? 'typescript' : 'javascript';
        if (isEmpty) {
            return `Act as a Senior Software Engineer. The codeblock is currently empty.

Please generate a complete, production-grade ${langTag} example demonstrating modern software architecture, strict type-safety, clean modular design, and robust error handling.`;
        }

        if (isInstructionOnly) {
            return `Act as a Senior Software Engineer. Based on the following requirement:

> "${instruction}"

Please provide a clean, production-ready ${langTag} implementation adhering to best practices, strict type-safety, and robust error handling.`;
        }

        return `Act as a Senior Software Engineer. Analyze the following ${langTag} code:

\`\`\`${langTag}
${cleanCode}
\`\`\`

Please review and provide:
1. Production implementation / clean refactoring following any inline instructions.
2. Type-safety improvements and robust error handling.
3. Edge cases and performance considerations.`;
    }

    // 4. Python
    if (['python', 'py'].includes(lang)) {
        if (isEmpty) {
            return `Act as a Senior Python Engineer. The codeblock is currently empty.

Please generate a complete, production-grade Python example adhering to PEP 8, with type annotations (mypy compatible), comprehensive docstrings, and robust error handling.`;
        }

        if (isInstructionOnly) {
            return `Act as a Senior Python Engineer. Based on the following requirement:

> "${instruction}"

Please provide a clean, pythonic implementation adhering to PEP 8, with type hints, docstrings, and robust error handling.`;
        }

        return `Act as a Senior Python Engineer. Analyze the following Python code:

\`\`\`python
${cleanCode}
\`\`\`

Please review and provide:
1. Pythonic refactoring adhering to PEP 8 and following any inline instructions.
2. Type annotations (mypy compatible) and docstrings.
3. Robust error handling and optimizations.`;
    }

    // 5. JSON, JSON5, YAML Data Schemas
    if (['json', 'json5', 'jsonl', 'yaml', 'yml'].includes(lang)) {
        if (isEmpty) {
            return `Act as a Data & Schema Engineer. The block is currently empty.

Please generate a comprehensive, production-grade ${lang.toUpperCase()} data specification and schema example, accompanied by matching TypeScript interface definitions.`;
        }

        if (isInstructionOnly) {
            return `Act as a Data & Schema Engineer. Based on the following requirement:

> "${instruction}"

Please provide a complete ${lang.toUpperCase()} schema and data example, along with TypeScript type definitions.`;
        }

        return `Act as a Data & Schema Engineer. Analyze the following structured data:

\`\`\`${lang}
${cleanCode}
\`\`\`

Please provide:
1. Schema analysis and validation observations.
2. Clean TypeScript type/interface definitions matching this structure.
3. Potential edge cases or data integrity improvements.`;
    }

    // 6. Shell & Bash Scripts
    if (['bash', 'sh', 'shell', 'zsh', 'powershell', 'ps1'].includes(lang)) {
        const shellTag = lang.includes('ps') ? 'powershell' : 'bash';
        if (isEmpty) {
            return `Act as a DevOps & Systems Engineer. The script block is currently empty.

Please generate a production-grade ${shellTag} script example with strict mode safety (e.g. \`set -euo pipefail\`), robust logging, idempotent execution, and error handling.`;
        }

        if (isInstructionOnly) {
            return `Act as a DevOps & Systems Engineer. Based on the following requirement:

> "${instruction}"

Please write a production-grade, secure ${shellTag} automation script with proper error handling and logging.`;
        }

        return `Act as a DevOps & Systems Engineer. Analyze the following ${shellTag} script:

\`\`\`${shellTag}
${cleanCode}
\`\`\`

Please review and provide:
1. Robust error handling, strict mode safety, and idempotency check.
2. Platform compatibility and security audit (injection, variable escaping).
3. Optimized production-grade version adhering to any instructions.`;
    }

    // 7. Systems Languages (Rust, Go, C++, C, Java)
    if (['rust', 'rs', 'go', 'golang', 'cpp', 'c', 'java'].includes(lang)) {
        if (isEmpty) {
            return `Act as a Senior Systems Engineer. The codeblock is currently empty.

Please generate an idiomatic, production-grade ${lang} implementation example with clean concurrency, memory efficiency, and robust error handling.`;
        }

        if (isInstructionOnly) {
            return `Act as a Senior Systems Engineer. Based on the following requirement:

> "${instruction}"

Please provide an idiomatic, production-ready ${lang} implementation with robust error handling and tests.`;
        }

        return `Act as a Senior Systems Engineer. Analyze the following ${lang} code:

\`\`\`${lang}
${cleanCode}
\`\`\`

Please review and provide:
1. Idiomatic implementation and memory/performance considerations.
2. Concurrency, error handling, and resource safety.
3. Clean refactoring with explanatory comments.`;
    }

    // 8. Markdown & Documentation
    if (['markdown', 'md'].includes(lang)) {
        if (isEmpty) {
            return `Act as an expert technical editor. The document block is currently empty.

Please generate a complete, structured technical documentation template in Markdown with executive summary, specifications, tables, and mermaid diagrams.`;
        }

        if (isInstructionOnly) {
            return `Act as an expert technical editor. Based on the following requirement:

> "${instruction}"

Please draft a complete, professional Markdown document covering this topic in depth.`;
        }

        return `Act as an expert technical editor. Review the following Markdown document:

\`\`\`markdown
${cleanCode}
\`\`\`

Please provide:
1. Structural analysis, clarity improvements, and refinement.
2. Actionable takeaways or summary.`;
    }

    // 9. Generic Fallback
    if (isEmpty) {
        return `Act as an expert software engineer. The codeblock is currently empty.

Please generate a complete, production-grade code example demonstrating best practices, clean architecture, and thorough documentation.`;
    }

    if (isInstructionOnly) {
        return `Act as an expert software engineer. Based on the following requirement:

> "${instruction}"

Please provide a clean, production-ready code implementation adhering to best practices and robust error handling.`;
    }

    return `Act as an expert software engineer. Analyze the following code snippet:

\`\`\`${lang || 'text'}
${cleanCode}
\`\`\`

Please review and provide:
1. Production implementation and clean refactoring following any specified instructions.
2. Edge cases, potential bugs, and performance optimizations.
3. Best practices and explanatory documentation.`;
}
