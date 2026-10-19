# Ember

Transparent, always-on-top pomodoro strip for Windows 11.

## Run

1. Install Node.js 20+
2. In this folder: `npm install` then `npm start`

The first launch opens an animated tutorial. Replay it any time from Settings, Tutorial.

## Build a portable .exe

`npm run dist` (output in `dist/`)

## Open settings

- Hover the widget and click the sliders icon, or
- Right-click the widget, Settings…

Settings cover durations (with presets), rounds before the long break, auto-start for breaks and focus,
color theme, glass opacity, compact size, chime and volume, notifications, stay on top, launch at login,
click-through, and reset to defaults. Changes apply right away.

## Controls

- Click the digits or press Space: start / pause
- S skip, R reset, M compact size
- Drag anywhere on the glass to move it (position is remembered)
- Scroll wheel over the widget: glass opacity
- Double-click: compact size
- Right-click: menu
- Ctrl+Alt+Space: start / pause from any app
- Ctrl+Alt+P: hide / show
- Ctrl+Alt+L: toggle click-through

## How to read it

One bar per minute (one per 2 or 3 minutes for long sessions), a taller bar every five.
Bars burn away left to right and the color travels along the theme.
Dots show your rounds before the long break.

Note: it stays above normal windows and borderless-fullscreen apps. Exclusive-fullscreen games can still cover it.
