# 🎒 v09: BubbleGraph 1st-Grade Visual Storyboard

> **Target Audience**: Anyone (explained like a 1st-grade student)  
> **Topic**: What is a Node? What is a Bubble? Why are they big or small?  
> **Source Logic**: `panel/src/features/bubblegraph/`  

---

## 🎨 COLOR PALETTE SPECIFICATION

| Element | Color Name | Hex Code | Visual Meaning |
|---|:---:|:---:|---|
| **Bubble Level 1** | **Gray** | `#64748b` | Top-level root folder / parent cluster |
| **Bubble Level 2** | **Cyan** | `#06b6d4` | Subfolder / 1st-level nested sub-bubble |
| **Bubble Level 3** | **Green** | `#10b981` | Deep nested subfolder / 2nd-level sub-bubble |
| **Nodes** | **Orange** | `#f97316` / `#ea580c` | Individual markdown notes (size scales by links) |

---

## 🟢 SLIDE 1: What is a Node? vs What is a Bubble?

```text
┌────────────────────────────────────────────────────────────────────────┐
│ SLIDE 1: THE BASICS (Student vs Classroom)                            │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   📄 NODE = A Single Note / File (ORANGE 🟠)                           │
│   -------------------------------------------                          │
│   • Think of a Node like a STUDENT in a school.                        │
│   • It represents one markdown file: e.g. "Catatan.md", "idea.md".    │
│   • It lives inside a folder.                                          │
│   • Visually: It's an ORANGE solid colored circle.                     │
│                                                                        │
│   📁 BUBBLE (Cluster) = A Folder (GRAY ⚪ / CYAN 🔵 / GREEN 🟢)        │
│   ------------------------------------------------------------         │
│   • Think of a Bubble like a CLASSROOM that holds the students.        │
│   • It represents a folder: e.g. "01 - Project Alpha", "Docs".        │
│   • It acts like an elastic balloon that surrounds all its files.      │
│   • Visually: It's a large transparent container circle.               │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 📏 SLIDE 2: Node Size — Based on What? (Orange Nodes 🟠)

```text
┌────────────────────────────────────────────────────────────────────────┐
│ SLIDE 2: WHY ARE SOME NODES BIGGER THAN OTHERS?                        │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   "How popular is this note in your vault?"                            │
│                                                                        │
│   1. THE LONELY NODE (No friends / 0 links):                           │
│      • Nobody links to it, and it links to nobody.                     │
│      • Degree = 0                                                      │
│      • Size = TINY (Radius = 3.5px, faint orange dot)                  │
│                                                                        │
│   2. THE FRIENDLY NODE (Connected with links):                         │
│      • Links to other notes: [[other_note]]                            │
│      • Formula: R = 3.5 + √Links                                       │
│      • Size = MEDIUM (Radius = 5.5px to 7px, bright orange)           │
│                                                                        │
│   3. THE CLASS CAPTAIN (Index / Readme Note):                          │
│      • The leader note of the folder with the most connections.        │
│      • Formula: R = 6.0 + √Links                                       │
│      • Size = BIG BOSS (Radius = 9px to 14px, deep vibrant orange)     │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🎈 SLIDE 3: Bubble Size — Based on What? (Color Hierarchy)

```text
┌────────────────────────────────────────────────────────────────────────┐
│ SLIDE 3: WHY DO BUBBLES EXPAND OR SHRINK?                              │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   "A balloon must expand so all toys inside can breathe without        │
│    crushing each other!"                                               │
│                                                                        │
│   • Level 1 Bubble: GRAY (#64748b)  ➔ Root Parent Classroom            │
│   • Level 2 Bubble: CYAN (#06b6d4)  ➔ Subfolder Study Group            │
│   • Level 3 Bubble: GREEN (#10b981) ➔ Deep Nested Special Team         │
│                                                                        │
│   • 0 Files inside   ➔ Bubble disappears (Radius = 0px)                │
│   • 1 File inside    ➔ Small room (Radius ≈ 16px)                      │
│   • 4 Files inside   ➔ Medium room (Radius ≈ 28px)                     │
│   • 10 Files inside  ➔ Big room (Radius ≈ 50px)                        │
│   • Has a SUB-FOLDER ➔ Huge room that wraps around the child bubble!   │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🌳 SLIDE 4: Example Structure 1 (Flat Folder with Mentions)

### Folder Hierarchy:
```text
root/
└── f1/ (Folder 1: Level 1 Gray Bubble)
    ├── node1.md (Orange Hub, mentioned by n2, n3, n4) ──▶ POPULAR STAR! ⭐
    ├── node2.md (Orange, mentions n1; mentioned by n3, n4)
    ├── node3.md (Orange, mentions n1, n2; mentioned by n4)
    └── node4.md (Orange, mentions n1, n2, n3; NO ONE mentions it)
```

---

## 🪆 SLIDE 5: Example Structure 2 (Nested Folder / Sub-bubble)

### Folder Hierarchy:
```text
root/
└── f1/ (Level 1 Gray Parent Bubble)
    └── f1sf1/ (Level 2 Cyan Sub-bubble)
        ├── node1.md (Orange Leader)
        └── node2.md (Orange Mentioner)
```

---

## 🌐 SLIDE 6: Example Structure 3 (Cross-Folder Bridges & The Mega-Hub)

### Folder Hierarchy:
```text
root/
├── f1/ (Level 1 Gray Cluster: 4 Orange nodes)
│   ├── node1.md  (Mentioned by: n2, n3, n4 + n6, n7, n8, n9, n11) ➔ SUPER STAR! 🌟
│   ├── node2.md  (Mentions n1; mentioned by n3, n4, n7, n8, n9, n11)
│   ├── node3.md  (Mentions n1, n2; mentioned by n4, n8, n9, n11)
│   └── node4.md  (Mentions n1, n2, n3; mentioned by n11)
│
└── f2/ (Level 1 Gray Cluster: 7 Orange nodes - LARGER BUBBLE!)
    ├── node5.md  (LONELY: 0 connections) ➔ Tiny Orange Dot (R = 3.5px)
    ├── node6.md  (Mentions n1 across to f1) ➔ Cross-folder link!
    ├── node7.md  (Mentions n1, n2 across to f1)
    ├── node8.md  (Mentions n1, n2, n3 across to f1)
    ├── node9.md  (Mentions n1, n2, n3 across to f1)
    ├── node10.md (LONELY: 0 connections) ➔ Tiny Orange Dot (R = 3.5px)
    └── node11.md (MEGA-HUB: Mentions ALL nodes 1 to 10!) ➔ GIGANTIC HUB! 👑
```
