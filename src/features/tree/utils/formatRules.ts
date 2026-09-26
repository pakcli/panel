/**
 * Tree Diagram Format Rules & Specification
 * Copy-pasteable documentation for AI assistants (ChatGPT, Claude, Gemini),
 * programmers, and users.
 */

export const TREE_EXAMPLE_CODEBLOCK = `\`\`\`tree
-interactive: true
-startshowlevel: 2
-levelnumbered: 0
-offsetlevelnumbered: 0
-title: Project Structure
-currentview: 1
-header: lowercase
root
	documentation
		Overview.md
		[[guides/quickstart|Quickstart Guide]]
	src
		features
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
- **lowercase = header**: Folder names, categories, and branch headers are written in **lowercase** (e.g. \`root\`, \`documentation\`, \`src\`, \`features\`, \`assets\`).
- **Capital = isi**: Content items, files, leaf notes, and documents are **Capitalized** (e.g. \`Overview.md\`, \`Main.ts\`, \`Logo.png\`, \`[[Quickstart Guide]]\`).

## 3. Codeblock Header Directives & Defaults
Place flags at the top of the codeblock. Each directive starts with \`-\` followed by \`key: value\`:
- \`-interactive: true | false\` (default: \`false\`)
  Enables clickable folder collapse/expand toggles.
- \`-startshowlevel: <number>\` (default: \`0\`)
  Initial visible depth level:
  • \`0\` = All folders collapsed (with more/less toggle) [DEFAULT]
  • \`1\` = Show root nodes only
  • \`2+\` = Automatically expand folders up to depth N
- \`-levelnumbered: <number>\` (default: \`0\`)
  Adds hierarchical outline numbers (e.g. 1, 1.1, 1.1.1):
  • \`0\` = Numbering disabled [DEFAULT]
  • \`1\` = Number root items only
  • \`2+\` = Number nodes down to depth N
- \`-offsetlevelnumbered: <number>\` (default: \`0\`)
  Outline number offset:
  • \`0\` = Root starts at 1, children start at 1.1 [DEFAULT]
  • \`1\` = Root is unnumbered, first-level children start at 1
- \`-title: <text>\` (default: empty / none)
  Custom header title displayed at the top of the tree diagram.
- \`-currentview: 1 | 2 | 3\` (default: \`1\`)
  Default layout view:
  • \`1\` = Tree Diagram View (ASCII/Unicode hierarchy) [DEFAULT]
  • \`2\` = Table FullView (All items in flattened spreadsheet table)
  • \`3\` = Table FolderView (Folder-grouped view)
- \`-header: lowercase | capitalcase\` (default: \`lowercase\`)
  Controls header casing:
  • \`lowercase\` = Folder and category headers formatted in lowercase [DEFAULT]
  • \`capitalcase\` = Headers formatted with capitalized words

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
"Generate a folder tree diagram inside a \`\`\`tree codeblock. Remember character case convention: lowercase for folder headers (root, src, docs) and Capitalized for isi/content (Main.ts, Readme.md). Include flags (-interactive: true, -startshowlevel: 2, -header: lowercase). Use literal tabs for indentation."
`;

export const TREE_FORMAT_RULES_BRIEF = `\`\`\`tree
-interactive: true
-startshowlevel: 2
-levelnumbered: 0
-offsetlevelnumbered: 0
-title: Project Structure
-currentview: 1
-header: lowercase
root
	documentation
		Overview.md
		[[guides/quickstart|Quickstart Guide]]
	src
		features
			Tree.ts
		Main.ts
	assets
		Logo.png
\`\`\`
Rules:
1. Casing: lowercase = header (folders/categories), Capital = isi (content/files).
2. Indentation: MUST use literal TAB (\\t) characters, not spaces.
3. Flags & Defaults:
   - -interactive: true (default: false)
   - -startshowlevel: 2 (default: 0)
   - -levelnumbered: 0 (default: 0)
   - -offsetlevelnumbered: 0 (default: 0)
   - -title: Project Structure (default: none)
   - -currentview: 1 (default: 1)
   - -header: lowercase | capitalcase (default: lowercase)
4. Obsidian wikilinks [[Target|Alias]] are fully supported.`;
