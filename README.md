# PakCLI Panel (Obsidian Plugin)

> 📊 **PakCLI Panel** is an all-in-one visual data manipulation, database exploration, ASCII creativity, and layout enhancement suite for [Obsidian](https://obsidian.md). It delivers Excel-grade virtualized CSV/TSV grids, in-memory SQLite WASM querying, animated ASCII canvas drawing, interactive Leaflet maps, and multi-pane file explorer split views.

![Version](https://img.shields.io/badge/version-1.0.42-green)
![Platform](https://img.shields.io/badge/platform-Desktop%20%26%20Mobile-blue)
![Obsidian](https://img.shields.io/badge/obsidian-%5E1.5.8-purple)
![License](https://img.shields.io/badge/license-MIT-yellow)

---

## 🌟 Architecture & Core Mechanics

PakCLI Panel brings enterprise-grade data management and visual media directly into Obsidian notes through isolated WebAssembly, virtualized renderers, and reactive state stores.

```
+-----------------------------------------------------------------------------------+
|                                  PAKCLI PANEL HUB                                 |
|                                                                                   |
|  +--------------------+  +--------------------+  +-----------------------------+  |
|  | CSV & Tablite Grid |  | SQLite WASM Engine |  |   ASCII Studio & Scaler     |  |
|  | - AG-Grid + Virtual|  | - wa-sqlite engine |  | - Multi-layer Canvas Studio |  |
|  | - TSV/Excel Paste  |  | - SQLSeal Queries  |  | - Animation Playback        |  |
|  | - Formula Rows     |  | - Schema Explorer  |  | - Note Margin Auto-scale    |  |
|  +--------------------+  +--------------------+  +-----------------------------+  |
|            |                       |                            |                 |
|  +--------------------+  +--------------------+  +-----------------------------+  |
|  | Leaflet Maps View  |  | Tree Visualizer    |  |  Explorer Split Views       |  |
|  | - OpenStreetMap    |  | - Folder Tree Ast  |  | - Dual Pane Navigation      |  |
|  | - GeoJSON & Pins   |  | - Dynamic Nodes    |  | - Recent Files Header Split |  |
|  +--------------------+  +--------------------+  +-----------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 🖼️ UI / UX Wireframes

### 1. Tablite CSV Grid View (`ag-theme-quartz`)

```
+-----------------------------------------------------------------------------------+
| [➕ Row] [➕ Col] [📋 Copy TSV] [📥 Paste TSV] [Wrap: ON] [🔍 Search] [⚙️ Columns]|
+-----------------------------------------------------------------------------------+
|  #   | ⋮⋮ Product Name      | ⋮⋮ Category    | ⋮⋮ Price ($)  | ⋮⋮ Stock  | ⋮⋮ Status |
+-----------------------------------------------------------------------------------+
|  1   | Antigravity Hub      | Software       | $149.00       | 28        | [Active]  |
|  2   | PakCLI Local Engine  | Utility        | $89.00        | 104       | [Active]  |
|  3   | Obsidian Table View  | Plugin         | $49.00        | 512       | [Active]  |
|  4   | SQLite WASM Bundle   | Database       | $79.00        | 64        | [Active]  |
+-----------------------------------------------------------------------------------+
| Σ    | Count: 4 Products    | Unique: 4      | Avg: $91.50   | Sum: 708  | 100% OK   |
+-----------------------------------------------------------------------------------+
```

### 2. SQLSeal SQLite Codeblock & Query Output

```markdown
```sqlseal
SELECT Category, COUNT(*) as TotalItems, AVG(Price) as AveragePrice
FROM inventory.db
GROUP BY Category
ORDER BY TotalItems DESC;
```
```

```
+-----------------------------------------------------------------------------------+
| 🗃️ [inventory.db] ── 3 rows returned in 1.4ms (wa-sqlite)          [📋 Copy] [CSV]|
+-----------------------------------------------------------------------------------+
| Category         | TotalItems       | AveragePrice                                |
+-----------------------------------------------------------------------------------+
| Plugin           | 1                | 49.00                                       |
| Software         | 1                | 149.00                                      |
| Utility          | 1                | 89.00                                       |
+-----------------------------------------------------------------------------------+
```

---

## ⚡ Core Feature Mechanics

### 1. 📊 Virtualized CSV & Tablite Grid Editor
- **Massive Dataset Handling**: Powered by `@ag-grid-community` and `@tanstack/react-virtual`, rendering hundreds of thousands of rows with zero UI stutter.
- **Excel & Sheets TSV Integration**: Full bidirectional copy-paste (`Ctrl+C` / `Ctrl+V`). Select any starting cell to paste tabular data with auto-expanding rows/columns and undo (`Ctrl+Z`).
- **Shift-Drag Selection**: Rectangular cell ranges, row spans (clicking `#`), and column spans (clicking headers).
- **Summary & Calculation Rows**: Live aggregations including `Sum`, `Average`, `Min`, `Max`, `Count`, and custom formulas.
- **Artifact Persistence**: Column widths, sort orders, and filters are automatically saved to `csv_view_artifacts/`.

### 2. 🗃️ SQLite WASM Database Explorer & SQLSeal
- In-browser WebAssembly SQLite engine (`wa-sqlite`) running entirely locally.
- Execute SQL queries directly inside notes using ````sqlseal ... ```` codeblocks.
- Inspect database schema, table structures, and relationships with interactive visual grids.

### 3. 🎨 ASCII Draw & Motion Studio
- Interactive visual canvas for creating ASCII art, flowcharts, and system diagrams.
- Multi-layer support, color palettes, and frame-by-frame animation playback.
- **Responsive Codeblock Scaler**: Automatically scales wide diagrams to fit note reading margins without overflowing.

### 4. 🗺️ Interactive Leaflet Maps
- Embed responsive maps directly in Markdown using ````leaflet ... ```` codeblocks.
- Place markers, draw polygon zones, and bind popup tooltips linking to notes.

### 5. 📂 File Explorer Split View & Navigation Enhancements
- Adds a dual-pane split toggle to Obsidian's file explorer.
- Recent files panel with folder-qualified paths (e.g. `work/index.md`) to avoid filename ambiguity.

---

## 📦 Requirements & Installation

1. **Obsidian** (v1.5.8+). Supports both Desktop and Mobile (Leaflet, CSV, and SQLite WASM are cross-platform).

### Manual Installation
Copy `main.js`, `manifest.json`, and `styles.css` into your Obsidian vault:
```
<vault>/.obsidian/plugins/pakcli-panel/
```
Enable **PakCLI Panel** under **Settings → Community Plugins**.

---

## 📄 License
MIT License © PakCLI Team
