/**
 * Tree Diagram Format Rules & Specification
 * Copy-pasteable documentation for AI assistants (ChatGPT, Claude, Gemini),
 * programmers, and users.
 */

export const TREE_EXAMPLE_CODEBLOCK = `\`\`\`tree
-interactive:false
-startshowlevel:0
-levelnumbered:0
-offsetlevelnumbered:0
-currentview:2
-header:capitalcase
-title:Project Structure

Root
	documentation
		Overview.md
		[[guides/quickstart|Quickstart Guide]]
	src
		Features
			Tree.ts
		Main.ts
	assets
		Logo.png
\`\`\``;

export const TREE_EXAMPLE_BRANCHES_CODEBLOCK = `\`\`\`tree
-interactive:true
-startshowlevel:4
-levelnumbered:0
-offsetlevelnumbered:0
-currentview:2
-header:capitalcase
-title:Git Branches

Branches
	Feat/stable-features-step-by-step
		remote
			2026-09-26 12:42:35 [71430f2] fix(ytd): fix 1080p resolution clamping and range slider handle edge pinning
		local
			2026-09-26 12:42:35 [71430f2] fix(ytd): fix 1080p resolution clamping and range slider handle edge pinning
	Feat-get-copy
		remote
			2026-09-23 16:30:55 [c4cb18a] feat(scriptSync): add diff viewer with swap and directional apply actions
		local
			2026-09-23 16:30:55 [c4cb18a] feat(scriptSync): add diff viewer with swap and directional apply actions
	Feat-stable-features-step-by-step
		remote
			2026-09-26 12:45:44 [41f7e20] Merge branch 'feat/stable-features-step-by-step'
		local
			2026-09-26 12:45:44 [41f7e20] Merge branch 'feat/stable-features-step-by-step'
	Main
		remote
			2026-09-26 12:45:44 [41f7e20] Merge branch 'feat/stable-features-step-by-step'
		local
			- [-] -
	Master
		remote
			2026-08-02 10:56:53 [07ceb81] Fix the year
		local
			2026-08-02 10:56:53 [07ceb81] Fix the year
	Table
		remote
			2026-09-01 21:11:25 [b7ea036] Update plugin ID in manifest.json
		local
			- [-] -
\`\`\``;

export const TREE_FORMAT_RULES_MD = `# Tree Diagram Codeblock Specification & AI Format Prompt

Use the following syntax and guidelines when generating or editing \`\`\`tree codeblocks for Obsidian.

## 1. Example Templates

### Template A: Standard Folder Structure (Table FullView)
${TREE_EXAMPLE_CODEBLOCK}

### Template B: Multi-Column Matrix Table (e.g. Git Branches / Comparison)
${TREE_EXAMPLE_BRANCHES_CODEBLOCK}

## 2. Character Casing Convention (CRITICAL FOR TABLES)
The Table View engine automatically distinguishes between **Table Columns** and **Table Rows** using character casing:
- **lowercase = Column Header**: Nodes written in **all lowercase** (e.g. \`remote\`, \`local\`, \`documentation\`, \`src\`, \`assets\`) automatically become **Table Column Headers**.
  • **DO NOT** capitalize column names in the source codeblock (e.g. write \`remote\`, NOT \`Remote:\`).
  • **DO NOT** add trailing colons \`:\` to column names.
  • Add \`-header:capitalcase\` to the flags so the table displays them capitalized in the UI (\`Remote\`, \`Local\`, \`Documentation\`).
- **Capital = Row Hierarchy / Isi (Content)**: Nodes containing at least one **Capital letter** (e.g. \`Branches\`, \`Main\`, \`Master\`, \`Feat/...\`, \`Overview.md\`, \`Logo.png\`) become **Row Items** or cell content.
  • If a branch name is \`main\` or \`master\` in all lowercase, capitalize it as \`Main\` or \`Master\` so the table engine recognizes it as a row rather than a column!

## 3. Codeblock Header Directives & Defaults
Place flags at the top of the codeblock. Each directive starts with \`-\` followed by \`key:value\`:
- \`-interactive:false\` (default: \`false\`)
  Enables clickable folder collapse/expand toggles.
- \`-startshowlevel:0\` (default: \`0\`)
  Initial visible depth level:
  • \`0\` = All folders collapsed (with more/less toggle) [DEFAULT]
  • \`1\` = Show root nodes only
  • \`2+\` = Automatically expand folders up to depth N
- \`-levelnumbered:0\` (default: \`0\`)
  Adds hierarchical outline numbers (e.g. 1, 1.1, 1.1.1):
  • \`0\` = Numbering disabled [DEFAULT]
  • \`1\` = Number root items only
  • \`2+\` = Number nodes down to depth N
- \`-offsetlevelnumbered:0\` (default: \`0\`)
  Outline number offset:
  • \`0\` = Root starts at 1, children start at 1.1 [DEFAULT]
  • \`1\` = Root is unnumbered, first-level children start at 1
- \`-title:Project Structure\` (default: empty / none)
  Custom header title displayed at the top of the tree diagram.
- \`-currentview:2\` (default: \`1\`)
  Default layout view:
  • \`1\` = Tree Diagram View (ASCII/Unicode hierarchy) [DEFAULT]
  • \`2\` = Table FullView (Spreadsheet table with merged rows and columns)
  • \`3\` = Table FolderView (Folder-grouped view with drilldown)
- \`-header:capitalcase\` (default: \`lowercase\`)
  Controls header casing in Tree Diagram and Table Headers:
  • \`lowercase\` = Folder and category headers formatted in lowercase [DEFAULT]
  • \`capitalcase\` = Headers formatted with capitalized words (e.g. \`remote\` -> \`Remote\`, \`local\` -> \`Local\`)

## 4. Hierarchy & Indentation Rules
- **CRITICAL**: Indentation MUST use literal TAB characters (\`\\t\`), or 4 spaces per depth. Never use irregular spacing!
- **Depth 0 (no tabs)**: Root Node (Row header / Parent).
- **Depth 1 (1 tab \`\\t\`)**: Direct child (Sub-row or Column).
- **Depth 2 (2 tabs \`\\t\\t\`)**: Content column or row value.
- **Depth 3 (3 tabs \`\\t\\t\\t\`)**: Cell content values.

## 5. Quick AI Prompt Snippet
Copy and paste this instruction when asking an AI assistant to generate a table:
"Generate a table inside a \`\`\`tree codeblock. Remember character case convention: all-lowercase for column headers (remote, local, documentation) and Capitalized for row items & isi (Branches, Main, Master, Overview.md). Do not use trailing colons on column names. Include flags (-interactive:true, -startshowlevel:4, -currentview:2, -header:capitalcase, -title:Git Branches). Use literal tabs for indentation."
`;

export const TREE_FORMAT_RULES_BRIEF = `\`\`\`tree
-interactive:true
-startshowlevel:4
-levelnumbered:0
-offsetlevelnumbered:0
-currentview:2
-header:capitalcase
-title:Git Branches

Branches
	Feat/stable-features-step-by-step
		remote
			2026-09-26 12:42:35 [71430f2] fix(ytd): fix 1080p resolution clamping and range slider handle edge pinning
		local
			2026-09-26 12:42:35 [71430f2] fix(ytd): fix 1080p resolution clamping and range slider handle edge pinning
	Main
		remote
			2026-09-26 12:45:44 [41f7e20] Merge branch 'feat/stable-features-step-by-step'
		local
			- [-] -
\`\`\`
Rules for Table View:
1. Columns MUST be all-lowercase: 'remote', 'local' (NO capitals, NO colons ':').
2. Rows MUST have capital letters: 'Branches', 'Main', 'Master' (all-lowercase rows will mistakenly become columns!).
3. Use -header:capitalcase to display columns as 'Remote', 'Local' in the table header.
4. Indentation: MUST use literal TAB (\\t) characters, not irregular spaces.
5. Views: -currentview:1 (Tree), 2 (Table FullView), 3 (Table FolderView).`;
