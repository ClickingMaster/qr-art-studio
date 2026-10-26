# QR Art Studio

Make QR codes where an image is built out of the code's own modules. Runs entirely in the browser; nothing is uploaded.

## Run

Open `index.html` directly, or serve the folder:

```sh
./serve.sh 8080              # this computer only
./serve.sh 8080 0.0.0.0      # also reachable from a phone on your network
```

## Use

1. Enter the text or URL.
2. Drop, paste or choose an image (a logo with a transparent or white background works best).
3. Pick a style (Blueprint, Bold, Poster, Etch, Halftone, Classic) and fine-tune if you like.
4. Raise **Detail** for a sharper image, and keep error correction on **H**.
5. Download the PNG, then test it with a phone before printing.

## Notes

- Always test the downloaded PNG with a real phone before printing or sharing. Heavily stylised codes (small dots, faint gray) can fail on some scanners; raise module size or outside strength if so.
- Only use images you have the right to use.

## Files

- `qr.js` – QR encoder (byte mode, versions 1–40, ECC L/M/Q/H), written from the ISO/IEC 18004 spec.
- `app.js` – rendering and UI.
- `index.html` – the page.

QR Code is a registered trademark of DENSO WAVE INCORPORATED.

## License

Public domain ([The Unlicense](https://unlicense.org)). Do whatever you like with it; no credit needed.
