# Patches

Applied on top of upstream `plandes/zotsite`, baseline commit `7b0594e`.

- `0001-native-storage-mapping.patch` — `src/zensols/zotsite/{itemmap,screate,app}.py`
  adds `file_mapping = native`: the export gets a junction/symlink `storage/` into the
  Zotero library instead of copying every attachment, plus a fix for `out_dir = None`
  creating a literal `None/` directory.
- `0002-pdfjs-viewer.patch` — `resources/site/src/{viewer.html,css/pdfviewer.css,js/pdfviewer.js,js/zotero.js}`
  serves PDFs through a bundled pdf.js viewer. Chrome's built-in viewer exposes no page
  number to JS, so the pdf.js page POSTs its current page to `/api/state`, which patches
  `storage/<KEY>/.zotero-reader-state` (Zotero's own reading-position file).

Both patches pass `git apply --check --reverse` against the current tree.

## Re-apply after `uv tool upgrade zensols.zotsite`

```powershell
cd D:\code\zotsite
git apply patches/0001-native-storage-mapping.patch patches/0002-pdfjs-viewer.patch
$sp = "W:\scoop\persist\uv\tools\versions\zensols-zotsite\Lib\site-packages\zensols\zotsite"
Copy-Item src\zensols\zotsite\*.py "$sp\" -Force
Copy-Item resources\site\src\viewer.html "$sp\resources\site\src\" -Force
Copy-Item resources\site\src\css\pdfviewer.css "$sp\resources\site\src\css\" -Force
Copy-Item resources\site\src\js\*.js "$sp\resources\site\src\js\" -Force
```

`uv tool upgrade` also wipes the pdf.js vendor files, so restore them too:

```powershell
npm pack pdfjs-dist@6.5.438     # needs the 127.0.0.1:7897 proxy
# copy build/pdf.min.mjs, build/pdf.worker.min.mjs, cmaps/, standard_fonts/, wasm/, iccs/
# into  resources\site\lib\js\pdfjs\  and  $sp\resources\site\lib\js\pdfjs\
```

The vendor tree is 4.88 MB (204 files) and is intentionally not in git; `resources/site`
is still matched by the `site` ignore rule, so new files there need `git add -f`.

## Serve

`python -u serve.py` — serves `site/` on http://127.0.0.1:8099 and accepts
`GET/POST /api/state`; writes to `D:/Zotero/DB/storage` by default (`-s` to change).
