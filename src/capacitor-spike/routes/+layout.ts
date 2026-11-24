// CL-819 spike: a bundled single-page app. Nothing renders on a server; adapter-static writes
// one index.html shell that the native WebView loads from inside the app.
export const ssr = false;
export const prerender = true;
