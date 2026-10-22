# Send to Folume (browser extension)

Adds a toolbar button and a right-click menu entry to Chrome, Edge, Brave and other Chromium browsers (Manifest V3).
It opens your Folume app with the paper you are looking at ready to add: the page, a link you right-clicked, or a
selected DOI or arXiv id. The app then downloads and converts it like any paper added from a link.

It asks for three permissions only: `activeTab` (to read the address of the tab you click it in), `contextMenus` and
`storage` (to remember where your app is). It has no host permissions and injects nothing into pages. It sends nothing
anywhere except to the address of your own app, which it opens in a new tab.

## Install

1. Open `chrome://extensions`, switch on **Developer mode**, choose **Load unpacked**, and pick this folder.
2. Open the extension's **Options** and enter the address of your Folume app (`http://localhost:8081` by default).

## Test

`node --test extension/lib.test.mjs` checks the address handling and the manifest without a browser.
