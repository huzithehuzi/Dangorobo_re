# Third Party Notices

This application includes third-party open source software and audio assets. The app's original models, textures, icon, and application code are by the project author unless noted otherwise.

## Runtime and Libraries

- Electron - MIT License - Copyright Electron contributors and GitHub Inc.
- Three.js - MIT License - Copyright three.js authors.
- `src/vendor/three/loaders/GLTFLoader.js`, `src/vendor/three/utils/BufferGeometryUtils.js`, and `src/vendor/three/utils/SkeletonUtils.js` are copied from the Three.js examples package and remain under the Three.js MIT License.
- Mermaid - MIT License - Copyright Mermaid contributors. `src/vendor/mermaid/mermaid.min.js` is the built browser bundle from the `mermaid` npm package, copied for offline rendering of AI-generated document summary diagrams (opened as standalone HTML files without a bundler). The bundle also compiles in several permissively-licensed third-party libraries (d3 - ISC, cytoscape - MIT, dompurify - MPL-2.0/Apache-2.0, katex - MIT, dayjs - MIT, marked - MIT, roughjs - MIT, js-yaml - MIT, lodash-es - MIT, and others; none copyleft) whose license notices are preserved as embedded `/*! Bundled license information */` comments inside the file itself. `mermaid` is a devDependency only (not shipped via `node_modules` in the packaged app) — this single vendored file is the only copy that ships.
- adm-zip - MIT License.
- Jimp and `@jimp/*` packages - MIT License.
- uiohook-napi - MIT License - Copyright Alexander Drozdov.

The packaged app also includes transitive npm dependencies required by the libraries above. Their license metadata is recorded in `package-lock.json` and their license files are included with the installed npm packages used by Electron Builder.

## Audio Assets

- `assets/sounds/talkingsound1.wav`
- `assets/sounds/talkingsound2.wav`
- `assets/sounds/talkingsound3.wav`

These per-character speech sounds were created by Josh Simmons (Acedio): https://github.com/Acedio

The alarm and click sound files in `assets/sounds/` (`alarm1-5.*`, `click1-6.*`) are public domain.
