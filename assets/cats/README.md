# Cat companion assets

This directory contains the first standalone illustrated character assets used by the timer and its isolated preview.

## Current character artwork

| Directory | Character | Current frame |
| --- | --- | --- |
| `soft-bell/` | White companion cat with red bell collar | `idle.png` |
| `sport-headband/` | Red headband sports cat | `idle.png` |
| `sleepy-nightcap/` | Blue nightcap comfort cat | `idle.png` |
| `leader-crown/` | Crown and red cape leader cat | `idle.png` |

Each character has a standard PNG and a high-resolution `idle@1536.png` export. The standard artwork is a 512 × 512 RGBA PNG. The PNGs are now referenced by both `v5.5.html` and `cat-companion-preview.html`; the gold ingot is layered separately so the same prop can animate with the character.

## Animation status

Only the idle illustration is currently available for each character. Work/carry, paid break, unpaid sleep, off-duty celebration, and click-interaction are not yet separate illustrated frames. Current CSS motion is a lightweight presentation effect, not frame-by-frame character animation.

Future frame sets should keep a consistent canvas, scale, transparent background, character proportions, and gold-bar design. Keep source artwork and exported web assets separate, and document dimensions, frame order, and licensing before adding further assets.

## Preview safety

The PR preview workflow packages this directory and the isolated preview page as a short-lived GitHub Actions artifact. It does not deploy to GitHub Pages, modify the production site, or access personal timer data.
