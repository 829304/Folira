# Debugging

> **Note (2026-11-08):** this page describes the upstream Electron toolchain and has not been rewritten for the Tauri shell. Folira's current structure, module boundaries and commands are in `CLAUDE.md` at the repository root: `pnpm --filter folira tauri:dev` runs the app, `pnpm --filter folira tauri:build` produces installers, `pnpm --filter folira test:unit` and `pnpm --filter folira typecheck` are the checks.

## Inspecting the running app

The renderer is a WebView page, so the recipes below no longer apply. In development on Windows, start the app with the WebView2 debugging port open and talk to it over the Chrome DevTools Protocol:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
pnpm --filter folira tauri:dev
```

`http://127.0.0.1:9222/json/list` then lists the editor page and the settings page (`…?type=settings`); anything that speaks CDP — a short Node script over `WebSocket`, or `chrome://inspect` — can evaluate expressions, capture screenshots and dispatch real mouse and keyboard events. This is how the theme and window behaviour are checked in the repository's own workflow.

On Linux the same role is played by WebKitGTK's inspector (`WEBKIT_INSPECTOR_SERVER`), and the Rust side is debugged with `rust-gdb` or `lldb` against the `folira` binary. Neither has been automated here yet.

## Use Visual Studio Code

The most simplest way is to debug using the `Debug MarkText` configuration. You can set breakpoints and use the `debugger` statement.

**Prerequisites:**

- VS Code's built-in JavaScript debugger (no extension needed — available since VS Code 1.47)

## Use Chrome Developer Tools

You can use the built-in developer tools via `View -> Toggle Developer Tools` in debug mode or connect via `chrome://inspect` using port `5858` for the main process and `8315` for the renderer process when launched via `pnpm run dev`.

### Debug built application

You can use the default Electron command-line parameters to enable debug mode as described above.

```shell
$ marktext --inspect=5858 --remote-debugging-port=8315
```

## Debug slow startup performance

Regardless of whether you are using the built or development version, you can use the [node-profiler](https://github.com/fxha/node-profiler) to analysis startup issues. Please follow the tool description for setup. Afterwards, launch the following commands in parallel (e.g. use three terminal windows and launch MarkText last).

```shell
$ node-profiler main
$ node-profiler renderer
$ marktext --inspect=5858 --remote-debugging-port=8315
```

After the successful launch of MarkText, press `Ctrl+C` on both `node-profiler` instances. The tools created two files named `main.cpuprofile` and `renderer.cpuprofile`. You can now analyse these files via *Chrome Developer Tools* or *Visual Studio Code*.
