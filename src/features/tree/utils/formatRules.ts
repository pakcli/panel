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

export const TREE_FORMAT_RULES_MD = `# Tree Diagram Codeblock Specification & AI Format Prompt

Use the following syntax and guidelines when generating or editing \`\`\`tree codeblocks for Obsidian.

## 1. Example Template
${TREE_EXAMPLE_CODEBLOCK}

## 2. Character Casing Convention (CRITICAL)
- **lowercase = header / columns**: Folder names, categories, and branch headers are written in **lowercase** (e.g. \`documentation\`, \`src\`, \`assets\`). In Table FullView (\`-currentview:2\`), all-lowercase nodes automatically become **Table Column Headers**.
- **Capital = isi / hierarchy**: Content items, files, leaf notes, and hierarchical parents are **Capitalized** (e.g. \`Root\`, \`Features\`, \`Main.ts\`, \`Overview.md\`, \`Logo.png\`, \`[[Quickstart Guide]]\`).

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
  • \`capitalcase\` = Headers formatted with capitalized words (e.g. \`documentation\` -> \`Documentation\`, \`src\` -> \`Src\`, \`assets\` -> \`Assets\`)

## 4. Hierarchy & Indentation Rules
- **CRITICAL**: Indentation MUST use literal TAB characters (\`\\t\`), never spaces!
- **Depth 0 (no tabs)**: Defines a Root Node (header). Multiple lines at depth 0 create multiple separate root trees.
- **Depth 1 (1 tab \`\\t\`)**: Direct child of the preceding Root Node.
- **Depth 2 (2 tabs \`\\t\\t\`)**: Direct child of the preceding Depth 1 node.
- **Depth N (N tabs)**: Child of the nearest preceding node with depth N-1.

## 5. Node Labels & Obsidian Links
- Plain text file or folder names: \`FolderName\`, \`Index.ts\`, \`Report.pdf\`
- Obsidian WikiLinks: \`[[Note Name]]\` or with aliases \`[[Note Name|Display Alias]]\`
- Mixed text with links: \`subfolder - [[Meeting Notes]]\`
- Nodes containing only a wikilink will automatically use the alias (or target note name) as their label.

## 6. Quick AI Prompt Snippet
Copy and paste this instruction when asking an AI assistant to generate a tree:
"Generate a folder tree diagram inside a \`\`\`tree codeblock. Remember character case convention: lowercase for folder headers/columns (documentation, src, assets) and Capitalized for isi/hierarchy (Root, Features, Main.ts, Readme.md). Include flags (-interactive:false, -startshowlevel:0, -currentview:2, -header:capitalcase, -title:Project Structure). Use literal tabs for indentation."
`;

export const TREE_FORMAT_RULES_BRIEF = `\`\`\`tree
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
\`\`\`
Rules:
1. Casing: lowercase = header/columns (documentation, src, assets), Capital = isi/hierarchy (Root, Features, Main.ts, Logo.png).
2. Indentation: MUST use literal TAB (\\t) characters, not spaces.
3. Views: -currentview:1 (Tree), 2 (Table FullView), 3 (Table FolderView).
4. Directives: -interactive:false, -startshowlevel:0, -levelnumbered:0, -offsetlevelnumbered:0, -currentview:2, -header:capitalcase, -title:Project Structure.
5. Obsidian wikilinks [[Target|Alias]] are fully supported.`;
