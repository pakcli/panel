/**
 * codeblockPromptTemplates.ts
 * Generates actionable, production-grade AI prompt templates for any codeblock.
 * Supports tree architecture scaffolding, language-specific refactoring, and query analysis.
 */

export function buildCodeblockPrompt(code: string, rawLang: string): string {
    const cleanCode = (code || '').trim();
    const lang = (rawLang || '').toLowerCase().trim();

    // 1. Panel Tree & Tree Architecture Scaffolding
    if (
        lang.startsWith('panel-tree') ||
        lang.startsWith('tree-') ||
        lang === 'tree' ||
        lang === 'structure' ||
        lang.includes('cascading')
    ) {
        return `Act as a Principal Software Engineer. Based on the following declarative project architecture with frontmatter directives:

\`\`\`panel-tree
${cleanCode}
\`\`\`

Please perform the following tasks:
1. Scaffold each file with clean, production-ready boilerplate code.
2. Accurately resolve and wire up internal imports based on the declared \`f?dependencies:\` lists.
3. Preserve all declared frontmatter properties (tags, status, priority, tier) in the generated notes/files.
4. Provide a concise summary of the module relationships.`;
    }

    // 2. SQL & Database Queries
    if (['sql', 'sqlite', 'mysql', 'postgres', 'postgresql', 'cst'].includes(lang)) {
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
        return `Act as a Senior Software Engineer. Analyze the following ${langTag} code:

\`\`\`${langTag}
${cleanCode}
\`\`\`

Please review and provide:
1. Production implementation / clean refactoring.
2. Type-safety improvements and robust error handling.
3. Edge cases and performance considerations.`;
    }

    // 4. Python
    if (['python', 'py'].includes(lang)) {
        return `Act as a Senior Python Engineer. Analyze the following Python code:

\`\`\`python
${cleanCode}
\`\`\`

Please review and provide:
1. Pythonic refactoring adhering to PEP 8.
2. Type annotations (mypy compatible) and docstrings.
3. Robust error handling and optimizations.`;
    }

    // 5. JSON, JSON5, YAML Data Schemas
    if (['json', 'json5', 'jsonl', 'yaml', 'yml'].includes(lang)) {
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
        return `Act as a DevOps & Systems Engineer. Analyze the following ${shellTag} script:

\`\`\`${shellTag}
${cleanCode}
\`\`\`

Please review and provide:
1. Robust error handling, strict mode safety, and idempotency check.
2. Platform compatibility and security audit (injection, variable escaping).
3. Optimized production-grade version.`;
    }

    // 7. Systems Languages (Rust, Go, C++, C, Java)
    if (['rust', 'rs', 'go', 'golang', 'cpp', 'c', 'java'].includes(lang)) {
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
        return `Act as an expert technical editor. Review the following Markdown document:

\`\`\`markdown
${cleanCode}
\`\`\`

Please provide:
1. Structural analysis, clarity improvements, and refinement.
2. Actionable takeaways or summary.`;
    }

    // 9. Generic Fallback
    return `Act as an expert software engineer. Analyze the following code snippet:

\`\`\`${lang || 'text'}
${cleanCode}
\`\`\`

Please review and provide:
1. Production implementation and clean refactoring.
2. Edge cases, potential bugs, and performance optimizations.
3. Best practices and explanatory documentation.`;
}
