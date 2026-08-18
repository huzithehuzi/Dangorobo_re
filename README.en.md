*[한국어](./README.md) · English · [日本語](./README.ja.md)*

# Dangorobo 1.0.0

A retro-flavoured desktop pet that lives in a corner of your screen. It watches your cursor, wags its tail as
you type, gets happy when you pet it, and reminds you to take breaks at set times. You can even
chat with it if you want.

Clicks pass right through it most of the time, so it never gets in your way. Windows only, and it
runs as a single executable with no installation needed.

## Contents

- [Getting started](#getting-started)
- [How the pet reacts](#how-the-pet-reacts)
- [Customization](#customization)
- [Screen effects](#screen-effects)
- [Alarms](#alarms)
- [Today's checklist](#todays-checklist)
- [Favorites launcher](#favorites-launcher)
- [Talking to your pet](#talking-to-your-pet)
- [Handy tools](#handy-tools)
- [Music/video controls](#musicvideo-controls)
- [Colors and fonts](#colors-and-fonts)
- [Shortcuts](#shortcuts)
- [Backing up settings](#backing-up-settings)
- [FAQ](#faq)

## Getting started

1. When you launch it, the pet appears in a corner of your screen and an icon shows up in the
   taskbar notification area.
2. **Right-click** the pet or the tray icon to open a menu. The settings window is there.
3. Just **drag** the pet anywhere you like. Its position is remembered the next time you launch.
4. Quit via the right-click menu or `Ctrl + Shift + Q`.

Korean, English, and Japanese are supported, and the language is picked automatically to match
your Windows language on first launch.

If you installed via the setup file (`Dangorobo-Setup.exe`), the app checks for new versions,
downloads them automatically, and asks whether to restart and install. The portable build
(`Dangorobo-Portable.exe`) does not check for updates, so you'll need to download new versions
yourself.

## How the pet reacts

- **Follows your mouse.** It turns its head toward the cursor.
- **Reacts to typing.** The faster you type, the bigger and faster its tail wags. It doesn't read
  what you type — only how often.
- **Squishes slightly on every click or keystroke,** like jelly, and can optionally play a sound
  on click (off by default).
- **Try petting its head.** Rub the mouse left and right over its head and it bows happily.
- **Gets startled when picked up.** It flails while being dragged.
- **Falls asleep when left alone.** With no input for a while (5 minutes by default) it closes its
  eyes and dozes, then wakes up when you move again.
- **Gets bored when idle.** It occasionally looks around, stretches, or waves on its own.
- **Lets you know when Caps Lock is on** (its face trembles with a startled expression).
- **Hides itself during games or presentations.** It detects fullscreen apps and tucks itself and
  its alarms away for a while (must be enabled).

## Customization

Change everything from the **Customization** tab in settings. Choices apply to the pet
immediately, and closing without saving reverts them.

- **Colors**: paint the head, body, ears, tail, hands, headgear, eyes, mouth, face pattern,
  face decoration, and body pattern separately.
- **Parts**: 5 ear styles (bear/bunny/cat/fox/droopy), 3 tail styles, 8 headgear styles (ribbon,
  choker, glasses, hats, halo, and more). Every category can also be set to "none."
- **Face**: combine eye/mouth shapes with a face pattern and decoration. The expression changes on
  its own depending on what's happening.
- **Import your own face art**: bundle your own expression images into a zip and the pet shows
  those instead of the built-in eyes/mouth.
- **Pick colors right on the pet**: if picking by name feels awkward, turn this mode on. Color
  cards for each part float next to the pet, connected by a line to the actual part, so you can
  choose while looking at the result.
- **Presets**: save a combination you like under a name and apply it later in one click. Thumbnail
  previews are shown, and you can export/import presets as files to move them to another PC.
  (Cherry, Miro, and Loro presets are built in by default.)

## Screen effects

Adjust these from the **Appearance** tab. If you don't like what you've changed, the "Reset
appearance to defaults" button brings everything back at once.

- **Size and tail speed**.
- **Pixel art**: raising the intensity makes the pet look like a chunky pixel-art sprite.
- **Palette limiting**: reduces the number of colors used for a retro look. Choose from Warm /
  Cool / Monochrome / Game Boy–style, or build your own gradient from colors you pick.
- **Dithering**: scatters color boundaries into a dot pattern like an old game (8 patterns).
- **Outline**: draws a border around the silhouette. Color and thickness are adjustable.
- **Line wobble**: makes the outline shake subtly, like a hand-drawn animation.
- **Lighting**: adjust the color, intensity, and direction of the light yourself.

## Alarms

Register as many as you like from the **Alarms** tab in settings.

- **Four repeat modes**: `every N minutes` / `on the hour` (every 1–12 hours) / `at a set time
  every day` (specific weekdays supported) / `once, after a delay`.
- `On the hour` rings at **:00 on the clock**, no matter when you added it.
- Each alarm can have its own **title and message**.
- **Pause and resume** without deleting, and **edit** the content later.
- When it's time, the pet cheers to let you know and waits until you dismiss it.
- Choose from 5 built-in alert sounds, or set **your own mp3/wav file per alarm**.
- Use the "Test alarm now" button to preview how it looks.
- Time remaining until the next alarm is visible in the right-click menu.
- **Weather briefing**: turn on "Include weather briefing" on a `daily` alarm and its message is
  auto-filled with morning/afternoon weather for today and tomorrow (4 lines — high, low, and
  precipitation chance) when it rings (set your location in the General tab first). Fetched via
  Open-Meteo, no sign-up required — locations in South Korea prefer Korea Meteorological
  Administration (KMA) data. You can also check anytime via **Check Weather** in the tray menu
  (toggle it on/off in the Tray tab).

## Today's checklist

A small window you open with `Ctrl + Shift + T`.

- Write items and check them off — **the pet celebrates** when you do.
- Reorder by dragging; the number remaining shows as a badge.
- The window can be placed and resized anywhere, and it's restored exactly as you left it.

## Favorites launcher

Launch your frequently used programs directly from the pet. Register up to 12 programs,
shortcuts, or web links; the default shortcut is `Ctrl + Shift + F`.

**Choose from 4 places to show it:**

| Mode | How it appears |
|---|---|
| Pet speech bubble | List shows above the pet's head (default) |
| Movable window | A small window you place anywhere |
| Floating button | An always-visible round button that fans open when clicked |
| Open at cursor | A pie menu appears right where you pressed the shortcut |

Icons are grabbed automatically from each program; if you don't like them, pick from 18 built-in
icon templates (with your own color) or supply your own image file. You can also switch between a
list view and a grid view.

## Talking to your pet

Powered by Google's Gemini. **You need to obtain and enter your own free API key** to use this,
and it's off by default.

1. Enter your API key in the **General** tab of settings (a link to get one is right next to the
   field).
2. Turn on the conversation feature and save.
3. Open the chat window with `Ctrl + Shift + A` or the right-click menu.

- **Choose a personality**: easygoing friend, polite and friendly, plain and to-the-point advisor,
  playful prankster, or write your own one-liner.
- **Nicknames**: decide what the pet calls you and what it calls itself.
- **Its expression changes** to match the reply, and it nods its head while "speaking."
- It answers in whatever language you asked in.
- **Let the pet talk first** (every 3–20 minutes). You can also make it react and start a
  conversation after a long petting session, or just press the "Call" button to talk to it
  directly.
- **Talking sound effects**: as each character of a reply appears, a small sound plays. Speed and
  pitch are adjustable.
- **Memory**: turn this on and it keeps the conversation going across sessions, gradually
  remembering things like your preferences and habits. You can see and delete exactly what it
  remembers from the **Memory** tab in settings, which appears once you turn on "Show 'Memory
  Management' tab (advanced users only)" in the Chat tab.
- Everything you've said to each other can be searched and deleted from **Q&A History** in the
  right-click menu.

Your API key is encrypted using Windows' secure storage and is never included in settings backups
or conversation logs.

## Handy tools

- **Document summary** (`Ctrl + Shift + D`) — paste a long piece of text and get back a
  nicely formatted HTML document with a title, summary, and subheadings. It draws tables and
  flowcharts automatically when needed, and you can add requests like "organize this as a table."
  (Requires the conversation feature to be on.)
- **Translate** (`Ctrl + Shift + E`) — instantly translates whatever text you've copied. The
  translation is shown first; press the copy button to actually put it on the clipboard.
  (Requires the conversation feature to be on.)
- **Resize image** (`Ctrl + Shift + R`) — scales a copied image up or down by 0.5–4x and copies
  the result back. A mode that keeps pixel art crisp is also available.

## Music/video controls

While something is playing on YouTube, Spotify, or similar apps, previous/play-pause/next buttons
appear at the pet's feet. You can adjust their size, position, and opacity, and even have the pet
nod its head along to the beat while something is playing (off by default).

## Colors and fonts

- **Speech bubble theme**: choose from 5 built-in themes (Charcoal, Rose, Ocean, Forest, Amber) or
  build a custom one by picking a background, accent, and text color. Applies to all windows.
- **Font**: pick from a curated list of fonts or any font installed on your PC.
- **UI scale and text size** can be enlarged independently.

## Shortcuts

| Feature | Default shortcut |
|---|---|
| Chat with pet | `Ctrl + Shift + A` |
| Favorites | `Ctrl + Shift + F` |
| Checklist | `Ctrl + Shift + T` |
| Document summary | `Ctrl + Shift + D` |
| Translate | `Ctrl + Shift + E` |
| Resize image | `Ctrl + Shift + R` |
| Quit | `Ctrl + Shift + Q` |

- Every shortcut except Quit **can be rebound to any combination you like.** Click the button in
  the **Shortcuts** tab of settings and press the keys you want (must include at least one of
  Ctrl/Alt/Shift).
- Shortcuts you don't use can be disabled individually. If another program is already using a
  combination, you'll be warned when you try to save it.
- Which items show up in the right-click menu can also be configured from the **Tray** tab in
  settings.

## Backing up settings

Export and import your entire configuration as a single file from the **General** tab in
settings. Handy when moving to a new PC.
For security, **the API key is not included in backups** — you'll need to re-enter it on the new
PC.

Settings, your checklist, and history are stored in the `%APPDATA%\dangorobo` folder, and never
leave this PC. (If you were already using this app before its name changed, it keeps using the
older folder, `%APPDATA%\low-poly-desktop-pet`.)

## FAQ

**Does it read what I'm typing?**
No. It never stores what keys you pressed — it only counts how many times you've typed in the
last few seconds, and uses that number to drive the tail speed.

**Does the pet block my clicks?**
Clicks pass right through it most of the time. Only the area where a speech bubble or favorites
menu is currently shown will actually receive clicks.

**The pet suddenly disappeared.**
If "postpone alarms while fullscreen" is on, it hides itself while you're in a game or
presentation. It comes back once you close that program. Also check whether you hid it yourself
from the right-click menu.

**I can't turn on the conversation feature.**
You need to enter an API key first. If you've exceeded the free quota or the key is invalid, the
reason is shown in the speech bubble.

**I want it to start automatically with Windows.**
Turn on "Launch at Windows startup" from the right-click menu.

## For developers

To run from source or build it yourself:

```powershell
npm ci
npm start
npm run dist
```

Working rules are documented in [`AGENTS.md`](./AGENTS.md). The project structure, feature
locations, and instructions for adding parts and assets are in
[`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md), and how to maintain the landing page is in
[`docs/SITE.md`](./docs/SITE.md) (both Korean only).

## Credits

Created by huzi / Programming help & review by Nyabi

The per-character speaking sound effect for talking sound effects was created by Josh Simmons
(https://github.com/Acedio).
See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for other open-source libraries and
external asset credits.
