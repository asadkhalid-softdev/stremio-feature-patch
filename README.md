<p align="center">
  <img src="https://raw.githubusercontent.com/Stremio/stremio-brand/master/logos/SVG/stremio-logo-icon-only-fullcolor.svg" alt="Stremio logo" width="96">
</p>

<h1 align="center">Stremio Feature Patch</h1>
<p align="center">Discover controls, Library watched filters, and local SRT loading for Stremio on Windows.</p>

An unofficial, local customization for the Stremio 5 desktop app. It adds a
Discover toolbar, makes Library's Watched / Not Watched chips work as filters,
and adds a local SRT file picker to the player subtitle menu,
without modifying Stremio's executable or your watched history.

## Features

| Control | Behavior |
| --- | --- |
| **Hide watched** | Hides titles carrying Stremio's watched tick. |
| **Discover metadata badges** | Shows the release year and IMDb rating in a centered row below each title when available. Missing values are omitted; series use their premiere year. Badges use the same metadata snapshot as filtering and sorting, without additional requests. |
| **Release year** | Accepts four digits. Press Enter or click outside to apply. Clear it to remove the filter. Series use their premiere year. |
| **IMDb range** | Two slider handles select an inclusive 0.0–10.0 range in steps of 0.1. Handles support keyboard arrows and cannot cross. |
| **Sort by** | Default catalog order, Release year, IMDb rating, or Popularity. |
| **Sort direction** | Toggle ascending or descending. The icon reflects the direction; the control is disabled for Default. |
| **100-result preload** | Prepares the first 100 catalog titles before showing filtered and sorted results. |
| **Load 100 more** | Explicitly expands the batch, reapplies filters and sorting, and returns to the top. |
| **Saved preferences** | Remembers year, IMDb range, sort mode, direction, and Hide watched locally across restarts. Preferences are shared across movies, series, and catalogs. |
| **Repair and restore** | Automatically detects Stremio and Node.js, repairs shortcuts after updates, and backs up shortcuts for restoration. |
| **Library watch filters** | Watched shows only ticked cards; Not Watched shows only unticked cards, independently of the Library sort. |
| **Local SRT subtitles** | Load a `.srt` file from the subtitle menu and use Stremio's existing Delay, Size, and Vertical Position controls. |

### Local SRT subtitles

While a video is open in Stremio's built-in player:

1. Open the **subtitles** menu from the player controls.
2. In the **Subtitles Settings** column, click **Load .srt file**.
3. Choose an SRT file. Stremio loads and selects it as a **Local** subtitle track.
4. Use the existing **Delay − / +** controls to adjust synchronization. The Size
   and Vertical Position controls apply through the same native subtitle system.

You can return to an embedded or add-on subtitle using the normal menu, or choose
OFF to disable subtitles. A new upload preserves an existing numeric subtitle
delay. The button accepts non-empty `.srt` files up to 10 MB and checks for valid
timing cues before replacing the active track. Decoding and rendering use
Stremio's local subtitle loader; the original file bytes are passed unchanged.

The patch reads the file locally; it does not upload it to this project's author
or copy it into the repository. Loaded files are for the current playback
session. Select the file again after restarting or changing videos. Local loading
is unavailable when the active player does not expose Stremio's local subtitle
API, such as an external playback implementation. This feature adds a file picker
to the local subtitle support that Stremio already uses for drag-and-drop.

### Library filters

In Library, **Watched** and **Not Watched** are mutually exclusive filters rather
than Stremio's native sort modes. Use them alongside **Last Watched**, **A–Z**,
**Z–A**, or **Most Watched**. Selecting a filter keeps the current normal sort;
changing the sort keeps the filter. A **Filter** divider separates the two kinds
of controls.

Click the active filter again, or **Clear filter**, to show all titles. Filtering
uses the same watched tick displayed on the cards; partially watched titles
without a tick belong to Not Watched. The Library filter and normal sort are
remembered locally, independently of Discover preferences.

The counter reports matching versus loaded Library cards. Normal Library
pagination continues while scrolling. If filtering removes the scrollbar, the
patch asks Stremio for further pages until there is enough content to scroll or
there are no more available pages. An old `sort=watched` or `sort=notwatched`
Library link is converted to the equivalent filter with the last normal sort
(Last Watched when no normal sort was saved). This does not mark or unmark titles.

### Discover: missing metadata

Each filter works independently:

- An empty **Year** includes titles with no known release year. Entering a year
  excludes unknown years and titles from other years.
- The full **IMDb 0–10** range includes titles with no known rating. Narrowing
  either endpoint excludes unknown ratings.
- Missing sort values go last in either direction. Ties preserve catalog order.
- Hide watched applies in addition to the other filters.

Partial year input is marked invalid and leaves the previously applied year
filter active until four digits are entered or the field is cleared.

### Browsing without unexpected reordering

The initial batch contains up to **100 titles before filtering**. If the toolbar
says **59 of 100 results**, 59 pass the active filters and 41 are hidden.

The batch and its sorting metadata stay fixed while you scroll. Scrolling does
not automatically fetch another page and shuffle unseen titles above you.
**Load 100 more** expands the batch explicitly and returns to the top after
re-sorting. Changing a local filter or sort also returns to the top.

Add-ons return whole pages, so extra fetched titles may be held back until the
next expansion. Some catalogs have fewer than 100 titles or may stop responding;
the toolbar reports the actual batch size. Choosing another type, catalog, or
genre starts a fresh 100-result batch.

Sorting applies to the prepared batch, **not the add-on's entire catalog**.
Popularity uses the catalog's `popularity` value, falling back to its Stremio,
TMDB, then Trakt popularity field. Scores and availability vary by add-on.

## Requirements

- Windows with Windows PowerShell 5.1 or newer.
- Stremio **5**, using `stremio-shell-ng.exe` and its WebView interface.
  Stremio 4, mobile, and TV apps are not supported.
- [Node.js](https://nodejs.org/) **22 or newer**, with built-in WebSocket support.
  The installer checks runtime capabilities. No npm packages are required.

## Install

1. Download and extract this repository, or clone it:

   ```bat
   git clone https://github.com/asadkhalid-softdev/stremio-feature-patch.git
   cd stremio-feature-patch
   ```

2. Double-click **Apply patch.cmd**. Keep the `payload` folder beside it.
3. Fully exit Stremio, including its system tray icon.
4. Open Stremio using a patched Desktop or Start menu shortcut. The new controls
   appear in Discover, Library, and the player's subtitle menu.

The installer detects Stremio from running processes, shortcuts, Windows install
records, prior patch configuration, and standard install locations. It detects
Node.js from PATH and common installation locations. It downloads nothing.
Administrator rights are normally unnecessary; modifying a system-wide shortcut
may require them. If multiple Stremio installations are found, select one with
`-StremioPath` rather than relying on an automatic guess.

The installed helper lives in `%LOCALAPPDATA%\StremioFilters`. After installation,
the repository folder is not needed to run Stremio. Launching the original
Stremio EXE directly bypasses the helper.

### Commands

Run these from a Command Prompt in the repository folder:

```bat
"Apply patch.cmd"
"Apply patch.cmd" -Check
"Apply patch.cmd" -StremioPath "D:\Apps\Stremio"
"Restore shortcuts.cmd"
```

`-Check` verifies detection and JavaScript syntax without changing the installation.
`-StremioPath` accepts either a folder or the full path to `stremio-shell-ng.exe`.
Repeated installation preserves the first shortcut backups. Accessible Desktop,
Start menu, and taskbar shortcuts are updated; a user Start menu shortcut is
created if needed.

## After a Stremio update

Run **Apply patch.cmd** again, then fully exit and reopen Stremio. This repairs
missing patch files, changed install paths, and overwritten shortcuts.

The web interface can change independently of the desktop app. This patch depends
on Stremio's current DOM, React catalog/player structure, native subtitle API,
and pagination behavior.
Reapplying unchanged code cannot repair an incompatible upstream change; the
payload may need updating.

## Restore original shortcuts

Double-click **Restore shortcuts.cmd**, then fully exit and reopen Stremio.
It restores backed-up shortcuts, removes shortcuts created by the patch, and
stops the helper. Installed patch files remain available for reinstallation.

Backups are stored in `%LOCALAPPDATA%\StremioFilters\patch-backups`. An old backup
can point to a previous installation path if Stremio moved; reinstalling Stremio
can recreate its original shortcuts.

## How it works and local data

The installer changes shortcuts to launch a hidden local Node.js helper. The
helper starts the original Stremio executable, connects to its WebView through
loopback debugging, and adds the Discover toolbar, Library filters, and local
subtitle picker. It reads catalog responses
and watched ticks; catalog data can also be recovered from the page's selected
catalog when attaching after it has loaded.

Only the metadata fields needed for the controls are transferred by the helper.
The patch does not add a telemetry service or send data to this project's author.
Normal Stremio and add-on network requests still occur, including metadata
recovery and pagination requests.

- Filter preferences live in the Stremio WebView's local storage.
- Generated install paths, logs, and shortcut backups stay under
  `%LOCALAPPDATA%\StremioFilters`.
- The helper uses **127.0.0.1:19247** for WebView debugging and
  **127.0.0.1:19248** to prevent duplicate helpers. These listeners are local,
  and debugging provides access to the WebView; do not expose or forward them.
- Runtime errors, if any, are written to `launcher.log` in the installed folder.
- This repository excludes local configuration, logs, backups, shortcuts, subtitle files,
  screenshots, environment files, and common credential files through `.gitignore`.

## Development and tests

No dependency installation is needed:

```bat
node --check payload\hide-watched.js
node --check payload\launcher.cjs
node --check payload\library-filters.js
node --check payload\local-subtitles.js
node --test tests\filter-engine.test.cjs tests\library-filters.test.cjs tests\local-subtitles.test.cjs
```

Optional integration checks require Stremio running through the patched launcher
with Discover open and its preload finished:

```bat
node tests\live-ui.cjs
node tests\live-batch.cjs
```

`live-ui.cjs` exercises the real controls and current catalog response, restores
filter settings afterward, and writes a local `preview.png` that Git ignores.
`live-batch.cjs` requires a fresh, paginated Cinemeta catalog with at least 100
available titles; it verifies stable scrolling and explicitly expands to 200.
It leaves that larger batch open. These checks interact with the live app.

With Library open, run `node tests\live-library.cjs` to check both watched
filters, independent sorting, clearing, keyboard activation, saved preferences,
and unchanged watched indicators. It restores the previous filter and sort.

With a video paused and its subtitle menu open, run `node tests\live-subtitles.cjs`
to import a generated temporary SRT through the real file chooser and verify the
native Delay buttons. It restores your original subtitle selection and checks
that playback stayed paused at the same position. Stremio may keep the unselected
test track in its Local list until you close the current video. The test deletes
the temporary file afterward and does not read any of your subtitle files.

## Attribution

Stremio's name and logo belong to their respective owners. The logo above is
referenced from the official [Stremio brand repository](https://github.com/Stremio/stremio-brand).
This project is independent and is not affiliated with or endorsed by Stremio.

## License

This project's code is available under the [MIT License](LICENSE).
Stremio's name, logo, and other third-party assets are not covered by this license.
