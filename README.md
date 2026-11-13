# 🏎️ F1 Widget

**A tiny floating track map that lives on your Mac desktop and watches F1 cars go round in circles, so you don't have to stare at a TV for two hours.**

---

## What is this?

A little always-on-top window that shows the circuit, with every driver's car moving around it in team colours. Drag it anywhere. Shrink it, and the cars shrink too (they're very obedient).

-  **Live track map**: the circuit is drawn from real position data, with a little F1 car per driver
-  **Timing tower**: position, gap to the car ahead, and tyre compound, just like on TV
-  **Lap counter**: so you know how long until the race is over and you have to go back to work
-  **LIVE / REPLAY badge**: replays the latest session when nothing is on, so it's never an empty room
-  **Drag it anywhere**: click and drag from anywhere on the box, no handle needed
-  **Menu bar icon**: click to hide or show, right-click for the menu
-  **No Dock icon**: it's a widget, not a roommate

## Quick start

You need [Node.js](https://nodejs.org) and a Mac.

```bash
git clone https://github.com/harishezhil/F1-Widget.git
cd F1-Widget
npm install
npm start
```

That's it. No API key, no sign-up, no sacrificing a tyre to the F1 gods, .

## Make it a proper Mac app (no terminal ever again)

```bash
npm run build
mkdir -p ~/Applications
cp -R dist/F1Widget-darwin-*/F1Widget.app ~/Applications/
xattr -cr ~/Applications/F1Widget.app
open ~/Applications/F1Widget.app
```

## Roadmap (a.k.a. things I'll do when I'm bored)

- [ ] Start at login
- [ ] Snap to screen corners
- [ ] Toggle between interval and gap to leader
- [ ] Safety car and flag indicators
- [ ] A pit-stop sound effect nobody asked for

## Disclaimer

This is an **unofficial fan project** and is not affiliated with, endorsed by, or connected to Formula 1, the FIA, or any team. F1, the F1 logo and related marks are trademarks of Formula One Licensing BV. Race data is provided by the community-run OpenF1 API.

No cars were harmed in the making of this widget. Several tyre compounds were mentioned, however.

---

*Built with Electron, coffee, and an unreasonable amount of curiosity about why the cars kept freezing.* 
