# TimeLens

> **Work in progress.** TimeLens isn't ready for everyday use yet and isn't on the Chrome Web Store. Contributions are welcome. See [Contributing](#contributing).

TimeLens is a Chrome extension that shows where your browsing time goes. It notices when you drift from work into distraction, and **Lens**, a small mascot, keeps you company with one-liners written by its own tiny on-device model.

Everything stays on your PC. TimeLens has no server and no account, and it never sends data anywhere.

## What it does
- **Live time tracking** per site, with a daily and weekly Usage view like a phone's Screen Time
- **Drift detection:** 5+ minutes on distracting sites shows up on a timeline
- **Site timers and Focus mode** to pause distracting sites
- **Lens**, a mascot whose lines come from a tiny language model running in the browser. You can rate its lines (Good / Bad / Skip), and it learns from your ratings.

## Try it (developer mode)
1. Clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the project folder.

Requires Chrome 116 or later.

## Contributing
Ideas, bug reports and pull requests are all welcome. Improving Lens's model is the most useful place to help:

- **Lines:** Lens's lines live in `model/data.py`. Add or reword lines there.
- **Retrain:** this needs Python 3 and CPU PyTorch.
  ```bash
  python -m venv model/.venv
  model/.venv/Scripts/python -m pip install torch numpy --index-url https://download.pytorch.org/whl/cpu
  model/.venv/Scripts/python model/train.py
  ```
  This rewrites `model/lens.bin` and `model/check.json`. To train from ratings, export your data from the side panel and add `--votes <export.json>`.
- **Tests:** run them before a pull request (Node 18+).
  ```bash
  npm test
  ```

## License
None yet. Please open an issue if you'd like to use the code.
