# BIM Model Viewer — UniFormat Classification Tool: Development Conversation

---

## Ben

I need to create an additional tool in my model viewer that helps me re-organize a model by the uniformat system down to level 3. Use the attached image as a reference. Either manually or through an automation. I put ifc models in the folder for you to look at.

---

## Claude

*Asked clarifying questions about mapping approach, UI placement, and reference image.*

---

## Ben

*(Answered questions:)*
- Hybrid approach (auto-map + manual override)
- New 'UniFormat' tab in sidebar
- Will re-upload reference image

---

## Ben

*(Uploaded ASTM Uniformat II Classification E1557-97 table image)*

Here you go.

---

## Claude

*Analyzed both IFC files (Snowdon Towers AR Simple.ifc — Architectural, ~4000 elements; Snowdon Towers ST.ifc — Structural, ~1400 elements). Both IFC2X3 from Revit 24.1 with sparse CSI UniFormat 1998 classification data (<5-10% coverage).*

*Built `uniformat.js` with:*
- Full ASTM E1557-97 hierarchy data structure (A through F, all L1/L2/L3)
- IFC type → UniFormat L3 auto-mapping table
- Property-based classification detection (reads IFCCLASSIFICATIONREFERENCE)
- Context-aware heuristics (IsExternal, storey position, name patterns)
- Manual override support
- Tree UI building with stats bar
- Override menus (single element + bulk assign)
- 3D isolation by UniFormat group
- CSV export

*Updated `index.html` with UniFormat tab, panel with toolbar/legend/tree container. Updated `styles.css` with comprehensive CSS for UniFormat tree. Updated `viewer.js` with `uniformat-refresh` event dispatch after model load.*

---

## Ben

Continue from where you left off.

---

## Claude

*Continued implementation and verification.*

---

## Ben

Dont worry about loading the page, I will load it in vs code. In the uniformat tree, can you give me the ability to select items in the tree structure, like selecting A Substructure to select all those elements, or select A10 foundations...you get the point.

---

## Claude

Added `selectByUniformat()`, `clearGroupSelection()` functions. Changed click behavior: toggle arrow expands/collapses, clicking elsewhere on header selects group in 3D. Added CSS for `.uf-group-selected` state. Double-click still isolates.

---

## Ben

That working but I need to pop out the property tab as its own panel similar to the section box panel. When I click on an element in the uniformat tree, it switches over to the property tab. Lets move the property tab out to a panel with a button in the top right to toggle it on or off.

---

## Claude

Removed Properties tab from sidebar tabs. Created floating `.props-panel` positioned top-right of viewer. Added "Props" toggle button in viewer toolbar. Added P keyboard shortcut. `selectElement()` now calls `showPropsPanel()` instead of `switchTab('properties')`.

---

## Ben

Can you give me a select right click option or the ability to select an element in the 3D view and assign it to one of the uniformat levels? Also the ability to select multiple objects. Also can I have an option by selecting element from an already selected element by same name?

---

## Claude

Refactored the entire selection system:

- Added `selectedKeys` Set for multi-select tracking
- `raycastElement()` helper for reuse
- `onCanvasClick()` now handles Ctrl/Cmd for additive selection
- `onCanvasRightClick()` shows 3D context menu
- `selectBySameName()` and `selectBySameType()` functions
- `show3DContextMenu()` with UniFormat assignment dropdown
- `highlightSelectedMeshes()` and `clearSelectionHighlights()` for multi-select rendering
- `showMultiSelectionInfo()` for multi-select info bar
- CSS for `.ctx3d-menu` context menu
- Exposed `window.__ufHierarchy`, `window.__ufSetClassification`, `window.__ufRefreshTree` from uniformat.js

---

## Ben

*(Shared a screenshot of the current context menu)*

Ok, need to expand the select all to have it by Category, Family, Family and Type, or Type. Sometimes the Name include the element unique id so you can select other same objects.

---

## Claude

Added `parseRevitClassification()` function and four new selection modes in `viewer.js`:

**`parseRevitClassification(data)`** — Extracts Revit's Category/Family/Type hierarchy from each element. Checks property sets first (looking for keys like `"Other.Family and Type"`, `"Other.Family"`, `"Other.Type"`) then falls back to parsing the `"Family:Type"` colon-delimited naming convention that Revit uses in IFC exports.

- **Category** (`selectByCategory`) — Selects by IFC entity type (equivalent to Revit Category — e.g., all Walls, all Columns)
- **Family** (`selectByFamily`) — Selects by the family name portion before the colon (e.g., all `"M_Single-Flush"` doors regardless of size)
- **Family & Type** (`selectByFamilyAndType`) — Selects by the full `"Family:Type"` string (e.g., all `"M_Single-Flush:0915 x 2134mm"`)
- **Type** (`selectByType`) — Selects by just the type variant after the colon (e.g., all `"0915 x 2134mm"` regardless of family)

Updated the context menu to replace the old "Select all [name]" / "Select all [Type]" items with a "Select All By" section showing all four levels, each with a hint showing the actual value that will be matched. The Type option only appears when the element actually has a distinguishable type (i.e., the name contains a colon separator).

Added `.ctx3d-section-label` and `.ctx3d-hint` CSS styles for the new menu layout.

---

## Ben

I need a selection clear button if you could add that.

---

## Claude

Added a **Clear** button (✕ icon) in the viewer toolbar next to Props. It calls `clearSelection()` which restores all mesh materials and clears the selection set. Also mapped to the **Q** key as a shortcut.

---

## Ben

Ah, perfect. Can you also update the selecting of the uniformat tree. It works great for selecting the tree, but I need to be able to deselect whatever I selected in the tree too.

---

## Claude

Added toggle behavior to `selectByUniformat()` — checks if the same group is already selected and if so, calls `clearGroupSelection()` instead. Now clicking the same UniFormat tree header a second time toggles the selection off, restoring all meshes to their original appearance and clearing the group highlight in the tree. Works at all three levels (L1, L2, L3).

---

## Ben

When I select an element in the 3D view, dont have it default to opening the property window. Only if I hit the property button after an object is selected.

---

## Claude

Removed `showPropsPanel()` calls from `selectElement()` and `addToSelection()`. The properties panel no longer auto-opens when selecting elements in the 3D view. It still populates the property data in the background, so when you hit the Props button (or `P`), it shows the details for whatever's selected right away.

---

## Ben

If I start manually assigning elements to different uniformats I am going to need a way to save those changes if I need to unload and reload the model.

---

## Claude

Implemented persistence for manual UniFormat overrides:

**Auto-save (localStorage)** — Every time a manual override is made (single element or bulk assign), it automatically persists to `localStorage` keyed by `filename:expressID` so the keys survive across sessions. When models are reloaded, `initUniformatPanel()` loads those overrides back before running classification.

**Export/Import (JSON files)** — Two new buttons in the UniFormat toolbar:
- **Save Overrides** — Downloads a `uniformat_overrides.json` file for sharing or backup
- **Load Overrides** — Imports a JSON file and merges into current overrides, then re-classifies

Key implementation details:
- `toStableKey()` / `fromStableKey()` — Converts between session-specific composite keys (`modelIdx:expressID`) and stable keys (`filename:expressID`) that survive reload
- Auto-save wired into `setManualClassification()` and `bulkAssignByType()` (batched for bulk operations)
- Status indicator flashes confirmation in the toolbar

---

## Ben

When selecting items in the uniformat and they highlight items in the 3d view, I also need them to be selected items so I can right-click and apply things. Make sense.

---

## Claude

Added `window.__ufSetSelectedKeys` function in viewer.js that bulk-sets `selectedKeys` from an external source. Updated `selectByUniformat()` in uniformat.js to push matching keys into the viewer's `selectedKeys` set after highlighting. Updated `clearGroupSelection()` to clear the viewer's `selectedKeys` when deselecting.

Now when you click a group in the UniFormat tree (L1, L2, or L3), right-clicking any of those highlighted elements shows the full context menu with the correct count and lets you assign UniFormat codes to the whole batch. Toggling the group off clears the viewer selection too.

---

## Ben

One more thing. Can you give me the ability to isolate the selection or hide the selection. And a way to turn everything back on. vs just relying on the xray when items are selected.

---

## Claude

Added three new buttons in the toolbar (after a separator):

- **Isolate** (`I`) — Hides everything except the selected elements, then clears the selection so you're looking at just those elements in their normal appearance
- **Hide** (`H`) — Hides the selected elements and keeps everything else visible
- **Show All** (`A`) — Restores all hidden elements back to visible. The button highlights when there are hidden elements so you know there's stuff turned off

Implementation:
- Added `hiddenKeys` Set to track manually hidden elements
- `isolateSelection()` — Sets non-selected meshes to `visible = false`, adds them to `hiddenKeys`
- `hideSelection()` — Sets selected meshes to `visible = false`, adds to `hiddenKeys`
- `showAll()` — Restores all meshes, clears `hiddenKeys`
- `updateVisibilityButtons()` — Shows active state and count on Show All button
- Works with any selection method — 3D click, multi-select, UniFormat tree groups, right-click "select by" options

---

## Ben

When I deselect the uniformat selected tree item or group I dont want it to reset the isolation in the 3d view. It resets it at the moment.

---

## Claude

Fixed `clearGroupSelection()` in uniformat.js to respect the viewer's `hiddenKeys` set. Previously it was forcing `mesh.visible = true` and `opacity = 0.88` on every mesh, blowing away isolation/hide state.

Changes:
- Added `hiddenKeys` to `getViewerState()` return object so uniformat.js can access it
- Updated `clearGroupSelection()` to check `hiddenKeys.has(key)` before restoring visibility — hidden elements stay hidden
- Updated `clearSelectionHighlights()` in viewer.js to also respect `hiddenKeys` when restoring opacity
- Changed `clearGroupSelection()` to use `window.__ufSetSelectedKeys(new Set())` instead of `window.__ufClearSelection()` to only clear the selection state without touching materials of hidden elements

Now deselecting a UniFormat tree group only clears the highlight colors and selection state — hidden/isolated elements stay exactly as they were. Only **Show All** (`A`) restores everything.
